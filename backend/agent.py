import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from google.oauth2 import service_account
from googleapiclient.discovery import build
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from supabase import Client, create_client


# The state object is the shared data packet passed from node to node.
# Each node receives the current state dict and returns a partial state update.
# LangGraph merges those updates into the latest state for the next node.
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    user_id: str
    user_metadata: Dict[str, Any]


def get_supabase_client() -> Client:
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_KEY"]
    return create_client(supabase_url, supabase_key)


def upsert_user_profile(
    user_id: str,
    *,
    name: str,
    timezone_name: str,
    prefs: Dict[str, Any],
) -> Dict[str, Any]:
    supabase = get_supabase_client()
    payload = {
        "id": user_id,
        "name": name,
        "timezone": timezone_name,
        "prefs": prefs,
    }
    response = supabase.table("profiles").upsert(payload).execute()
    if isinstance(response.data, list) and response.data:
        return response.data[0]
    return payload


def get_calendar_service():
    credentials = service_account.Credentials.from_service_account_file(
        os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "service_account.json"),
        scopes=["https://www.googleapis.com/auth/calendar"],
    )
    return build("calendar", "v3", credentials=credentials)


@tool
def list_events() -> List[Dict[str, Any]]:
    """Fetch Google Calendar events scheduled in the next 24 hours."""
    service = get_calendar_service()
    calendar_id = os.environ.get("GOOGLE_CALENDAR_ID", "primary")

    now = datetime.now(timezone.utc)
    tomorrow = now + timedelta(hours=24)

    response = (
        service.events()
        .list(
            calendarId=calendar_id,
            timeMin=now.isoformat(),
            timeMax=tomorrow.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    events = response.get("items", [])
    return [
        {
            "id": event.get("id"),
            "summary": event.get("summary"),
            "description": event.get("description"),
            "start": event.get("start"),
            "end": event.get("end"),
            "status": event.get("status"),
        }
        for event in events
    ]


@tool
def manage_event(
    action: str,
    summary: str,
    start_time: str,
    end_time: str,
    description: str = "",
    event_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Create or update a Google Calendar event. Use action='create' or action='update'."""
    service = get_calendar_service()
    calendar_id = os.environ.get("GOOGLE_CALENDAR_ID", "primary")

    event_body = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start_time},
        "end": {"dateTime": end_time},
    }

    if action == "create":
        created_event = (
            service.events().insert(calendarId=calendar_id, body=event_body).execute()
        )
        return {
            "status": "created",
            "event_id": created_event.get("id"),
            "html_link": created_event.get("htmlLink"),
        }

    if action == "update":
        if not event_id:
            raise ValueError("event_id is required when action='update'")
        updated_event = (
            service.events()
            .update(calendarId=calendar_id, eventId=event_id, body=event_body)
            .execute()
        )
        return {
            "status": "updated",
            "event_id": updated_event.get("id"),
            "html_link": updated_event.get("htmlLink"),
        }

    raise ValueError("action must be either 'create' or 'update'")


TOOLS = [list_events, manage_event]


def fetch_user_data(state: AgentState) -> Dict[str, Any]:
    """Load a user's profile from Supabase and place it into state['user_metadata'].""" 
    supabase = get_supabase_client()
    user_id = state["user_id"]

    try:
        response = (
            supabase.table("profiles")
            .select("name, timezone, prefs")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        if isinstance(response.data, list) and response.data:
            profile = response.data[0]
        elif isinstance(response.data, dict):
            profile = response.data
        else:
            profile = {}
    except Exception:
        profile = {}

    user_metadata = {
        "name": profile.get("name", "there"),
        "timezone": profile.get("timezone", "UTC"),
        "prefs": profile.get("prefs", {}),
    }
    return {"user_metadata": user_metadata}


def build_system_prompt(user_metadata: Dict[str, Any]) -> str:
    name = user_metadata.get("name", "there")
    timezone_name = user_metadata.get("timezone", "UTC")
    prefs = user_metadata.get("prefs", {})
    return (
        f"You are a helpful AI calendar agent assisting {name}. "
        f"The user's timezone is {timezone_name}. "
        f"The user preferences are: {prefs}. "
        "Use the available calendar tools whenever the user asks to inspect, create, "
        "or update calendar events. Be concise, accurate, and proactive."
    )


def call_model(state: AgentState) -> Dict[str, Any]:
    """Call Gemini with the latest state and let it decide whether to use tools."""
    google_api_key = os.getenv("GOOGLE_API_KEY")
    model_name = os.getenv("GOOGLE_MODEL", "gemini-2.5-flash")

    model = ChatGoogleGenerativeAI(
        model=model_name,
        google_api_key=google_api_key,
        temperature=0.2,
    ).bind_tools(TOOLS)

    system_prompt = build_system_prompt(state.get("user_metadata", {}))
    # We prepend a fresh system message built from state["user_metadata"].
    # The existing state["messages"] already contains the running chat history
    # because add_messages appends prior turns during graph execution.
    model_input: List[BaseMessage] = [SystemMessage(content=system_prompt), *state["messages"]]
    response = model.invoke(model_input)
    return {"messages": [response]}


def build_graph():
    graph_builder = StateGraph(AgentState)

    graph_builder.add_node("fetch_user_data", fetch_user_data)
    graph_builder.add_node("call_model", call_model)
    graph_builder.add_node("tools", ToolNode(TOOLS))

    graph_builder.add_edge(START, "fetch_user_data")
    graph_builder.add_edge("fetch_user_data", "call_model")
    graph_builder.add_conditional_edges(
        "call_model",
        tools_condition,
        {
            "tools": "tools",
            "__end__": END,
        },
    )
    graph_builder.add_edge("tools", "call_model")

    checkpointer = MemorySaver()
    return graph_builder.compile(checkpointer=checkpointer)


graph = build_graph()


def run_agent(user_id: str, thread_id: str, message: str) -> Dict[str, Any]:
    config = {"configurable": {"thread_id": thread_id}}
    # This initial state is the first packet given to the graph for the current turn.
    # MemorySaver uses thread_id to stitch this turn together with prior turns.
    initial_state: AgentState = {
        "messages": [HumanMessage(content=message)],
        "user_id": user_id,
        "user_metadata": {},
    }
    result = graph.invoke(initial_state, config=config)

    final_text = ""
    for agent_message in reversed(result["messages"]):
        if isinstance(agent_message, AIMessage) and agent_message.content:
            if isinstance(agent_message.content, str):
                final_text = agent_message.content
            else:
                final_text = str(agent_message.content)
            break

    return {"response": final_text, "state": result}
