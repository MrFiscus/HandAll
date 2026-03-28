import os
import sqlite3
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from pathlib import Path
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
from dotenv import load_dotenv
from supabase import Client, create_client


ROOT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
SQLITE_DB_PATH = Path(__file__).resolve().parent / "handall.db"
load_dotenv(ROOT_ENV_FILE)

if not os.getenv("SUPABASE_KEY") and os.getenv("SUPABASE_ANON_KEY"):
    os.environ["SUPABASE_KEY"] = os.environ["SUPABASE_ANON_KEY"]

CURRENT_AGENT_CONTEXT: ContextVar[Dict[str, Any]] = ContextVar("current_agent_context", default={})


# The state object is the shared data packet passed from node to node.
# Each node receives the current state dict and returns a partial state update.
# LangGraph merges those updates into the latest state for the next node.
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    user_id: str
    auth_user_id: Optional[str]
    motivation: int
    user_metadata: Dict[str, Any]


def get_supabase_client() -> Client:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL or SUPABASE_KEY is not configured")
    return create_client(supabase_url, supabase_key)


def upsert_user_profile(
    user_id: str,
    *,
    name: str,
    timezone_name: str,
    prefs: Dict[str, Any],
) -> Dict[str, Any]:
    payload = {
        "id": user_id,
        "name": name,
        "timezone": timezone_name,
        "prefs": prefs,
    }
    try:
        supabase = get_supabase_client()
    except RuntimeError:
        return payload
    response = supabase.table("profiles").upsert(payload).execute()
    if isinstance(response.data, list) and response.data:
        return response.data[0]
    return payload


def get_calendar_service():
    credentials = service_account.Credentials.from_service_account_file(
        os.environ.get(
            "GOOGLE_SERVICE_ACCOUNT_FILE",
            str(Path(__file__).resolve().parents[1] / "backend" / "credentials" / "google-service-account.json"),
        ),
        scopes=["https://www.googleapis.com/auth/calendar"],
    )
    return build("calendar", "v3", credentials=credentials)


def _get_agent_context() -> Dict[str, Any]:
    return CURRENT_AGENT_CONTEXT.get({}) or {}


def _open_app_db() -> sqlite3.Connection:
    connection = sqlite3.connect(SQLITE_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def _normalize_task_type(task_type: str) -> str:
    normalized = (task_type or "working").strip().lower()
    if normalized in {"free", "free time"}:
        return "freetime"
    if normalized not in {"class", "assignment", "working", "goal", "freetime", "external"}:
        return "working"
    return normalized


def _parse_iso_datetime(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _resolve_local_user(auth_user_id: Optional[str], user_metadata: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    if not auth_user_id:
        return None

    with _open_app_db() as connection:
        existing = connection.execute(
            "SELECT * FROM users WHERE auth_user_id = ?",
            (auth_user_id,),
        ).fetchone()
        if existing:
            return dict(existing)

        display_name = (
            (user_metadata or {}).get("name")
            or "Student"
        )
        cursor = connection.execute(
            "INSERT INTO users (auth_user_id, username, xp, level) VALUES (?, ?, 0, 0)",
            (auth_user_id, display_name),
        )
        connection.commit()
        created = connection.execute(
            "SELECT * FROM users WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return dict(created) if created else None


def _serialize_task_row(row: sqlite3.Row) -> Dict[str, Any]:
    task_type = (row["type"] or "working").lower()
    return {
        "id": str(row["id"]),
        "external_id": row["external_id"],
        "title": row["title"],
        "description": row["description"] or "",
        "type": task_type,
        "start": row["start_time"],
        "end": row["end_time"],
        "status": row["status"] or "Pending",
        "source_url": row["source_url"],
    }


def _get_upcoming_tasks(local_user_id: int, days: int) -> List[Dict[str, Any]]:
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    with _open_app_db() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND end_time >= ?
              AND start_time <= ?
            ORDER BY start_time ASC
            """,
            (local_user_id, now_iso, horizon_iso),
        ).fetchall()
    return [_serialize_task_row(row) for row in rows]


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


@tool
def list_schedule(days: int = 7) -> Dict[str, Any]:
    """List upcoming HandAll schedule blocks for the authenticated user."""
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can inspect the app schedule.",
            "tasks": [],
        }

    safe_days = max(1, min(int(days or 7), 30))
    tasks = _get_upcoming_tasks(int(local_user["id"]), safe_days)
    return {
        "success": True,
        "days": safe_days,
        "count": len(tasks),
        "tasks": tasks[:25],
    }


@tool
def add_app_task(
    title: str,
    start_time: str,
    end_time: str,
    task_type: str = "working",
    description: str = "",
) -> Dict[str, Any]:
    """Add a HandAll task block to the app schedule."""
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can add tasks.",
        }

    start_dt = _parse_iso_datetime(start_time)
    end_dt = _parse_iso_datetime(end_time)
    if end_dt <= start_dt:
        raise ValueError("end_time must be after start_time")

    normalized_type = _normalize_task_type(task_type)
    with _open_app_db() as connection:
        cursor = connection.execute(
            """
            INSERT INTO tasks (user_id, title, description, start_time, end_time, type, status)
            VALUES (?, ?, ?, ?, ?, ?, 'Accepted')
            """,
            (
                local_user["id"],
                title.strip(),
                description.strip() or None,
                start_dt.isoformat(),
                end_dt.isoformat(),
                normalized_type,
            ),
        )
        connection.commit()
        created = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()

    return {
        "success": True,
        "message": f"Added '{title}' to the HandAll schedule.",
        "task": _serialize_task_row(created) if created else None,
    }


@tool
def remove_app_task(task_identifier: str) -> Dict[str, Any]:
    """Remove a HandAll task by id or by matching its title."""
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can remove tasks.",
        }

    identifier = (task_identifier or "").strip()
    if not identifier:
        raise ValueError("task_identifier is required")

    with _open_app_db() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND (CAST(id AS TEXT) = ? OR external_id = ?)
            LIMIT 1
            """,
            (local_user["id"], identifier, identifier),
        ).fetchone()

        if not row:
            exact_matches = connection.execute(
                """
                SELECT *
                FROM tasks
                WHERE user_id = ?
                  AND lower(title) = lower(?)
                ORDER BY start_time ASC
                LIMIT 2
                """,
                (local_user["id"], identifier),
            ).fetchall()
            if len(exact_matches) == 1:
                row = exact_matches[0]
            elif len(exact_matches) > 1:
                return {
                    "success": False,
                    "message": "More than one task matches that exact title. Use a task id or be more specific.",
                    "matches": [_serialize_task_row(match) for match in exact_matches],
                }

        if not row:
            partial_matches = connection.execute(
                """
                SELECT *
                FROM tasks
                WHERE user_id = ?
                  AND lower(title) LIKE ?
                ORDER BY start_time ASC
                LIMIT 5
                """,
                (local_user["id"], f"%{identifier.lower()}%"),
            ).fetchall()
            if len(partial_matches) == 1:
                row = partial_matches[0]
            elif partial_matches:
                return {
                    "success": False,
                    "message": "I found multiple possible tasks. Tell me which one to remove by id or exact title.",
                    "matches": [_serialize_task_row(match) for match in partial_matches],
                }

        if not row:
            return {
                "success": False,
                "message": f"I couldn't find a HandAll task matching '{identifier}'.",
            }

        deleted = _serialize_task_row(row)
        connection.execute(
            "DELETE FROM tasks WHERE id = ?",
            (row["id"],),
        )
        connection.commit()

    return {
        "success": True,
        "message": f"Removed '{deleted['title']}' from the HandAll schedule.",
        "task": deleted,
    }


@tool
def rebalance_app_plan(days: int = 7) -> Dict[str, Any]:
    """Rebuild upcoming HandAll working, goal, and free-time tasks around existing calendar commitments."""
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can rebalance the plan.",
        }

    from backend.planner import generate_weekly_plan

    safe_days = max(3, min(int(days or 7), 14))
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=safe_days)).isoformat()
    motivation = max(0, min(int(context.get("motivation") or 50), 100))
    timezone_name = context.get("user_metadata", {}).get("timezone") or "UTC"

    with _open_app_db() as connection:
        all_rows = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND end_time >= ?
              AND start_time <= ?
            ORDER BY start_time ASC
            """,
            (local_user["id"], now_iso, horizon_iso),
        ).fetchall()

        current_events = []
        for row in all_rows:
            row_type = (row["type"] or "working").lower()
            row_status = (row["status"] or "").lower()
            if row_type in {"working", "goal", "freetime", "free"} and row_status != "completed":
                continue
            current_events.append(
                {
                    "id": row["external_id"] or str(row["id"]),
                    "title": row["title"],
                    "description": row["description"] or "",
                    "start": row["start_time"],
                    "end": row["end_time"],
                    "type": row_type,
                    "completed": row_status == "completed",
                    "sourceUrl": row["source_url"],
                }
            )

        deleted_rows = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND start_time >= ?
              AND start_time <= ?
              AND lower(type) IN ('working', 'goal', 'freetime', 'free')
              AND lower(status) != 'completed'
            ORDER BY start_time ASC
            """,
            (local_user["id"], now_iso, horizon_iso),
        ).fetchall()
        deleted_count = len(deleted_rows)

        connection.execute(
            """
            DELETE FROM tasks
            WHERE user_id = ?
              AND start_time >= ?
              AND start_time <= ?
              AND lower(type) IN ('working', 'goal', 'freetime', 'free')
              AND lower(status) != 'completed'
            """,
            (local_user["id"], now_iso, horizon_iso),
        )

        plan = generate_weekly_plan(
            {
                "user_id": str(local_user["id"]),
                "name": local_user.get("username") or context.get("user_metadata", {}).get("name") or "Student",
                "timezone": timezone_name,
                "wake_time": local_user.get("wake_time") or "07:00",
                "sleep_time": local_user.get("sleep_time") or "23:00",
                "side_goals": [local_user["side_goal"]] if local_user.get("side_goal") else [],
                "motivation": motivation,
                "horizon_days": safe_days,
                "events": current_events,
                "assignments": [],
            }
        )

        inserted = []
        for task in plan.get("suggested_tasks", []):
            cursor = connection.execute(
                """
                INSERT INTO tasks (user_id, external_id, title, description, start_time, end_time, type, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Accepted')
                """,
                (
                    local_user["id"],
                    task.get("id"),
                    task.get("title"),
                    task.get("description") or None,
                    task.get("start"),
                    task.get("end"),
                    _normalize_task_type(str(task.get("type") or "working")),
                ),
            )
            created = connection.execute(
                "SELECT * FROM tasks WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()
            if created:
                inserted.append(_serialize_task_row(created))

        connection.commit()

    return {
        "success": True,
        "message": f"Rebalanced your next {safe_days} days by replacing {deleted_count} planned blocks with {len(inserted)} updated suggestions.",
        "deleted_count": deleted_count,
        "inserted_count": len(inserted),
        "assignments": plan.get("assignments", []),
        "tasks": inserted,
        "meta": plan.get("meta", {}),
    }


TOOLS = [list_events, manage_event, list_schedule, add_app_task, remove_app_task, rebalance_app_plan]


def fetch_user_data(state: AgentState) -> Dict[str, Any]:
    """Load a user's profile from Supabase and place it into state['user_metadata'].""" 
    user_id = state["user_id"]
    try:
        supabase = get_supabase_client()
    except RuntimeError:
        return {
            "user_metadata": {
                "name": "there",
                "timezone": "UTC",
                "prefs": {},
            }
        }

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
    current_context = dict(_get_agent_context())
    current_context["user_metadata"] = user_metadata
    CURRENT_AGENT_CONTEXT.set(current_context)
    return {"user_metadata": user_metadata}


def build_system_prompt(user_metadata: Dict[str, Any]) -> str:
    name = user_metadata.get("name", "there")
    timezone_name = user_metadata.get("timezone", "UTC")
    prefs = user_metadata.get("prefs", {})
    context = _get_agent_context()
    motivation = context.get("motivation", 50)
    return (
        f"You are HandAll's helpful AI planning agent assisting {name}. "
        f"The user's timezone is {timezone_name}. "
        f"The user preferences are: {prefs}. "
        f"The user's current motivation score is {motivation}/100. "
        "Use HandAll schedule tools to add, remove, inspect, and rebalance tasks inside the app whenever the user asks about their workload or plan. "
        "Use the Google Calendar tools only when the user explicitly wants external calendar events inspected or changed. "
        "When you edit the app schedule, confirm what you changed in plain language. Be concise, accurate, and proactive."
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
    context_token = CURRENT_AGENT_CONTEXT.set(
        {
            "user_id": state["user_id"],
            "auth_user_id": state.get("auth_user_id"),
            "motivation": state.get("motivation", 50),
            "user_metadata": state.get("user_metadata", {}),
        }
    )
    try:
        response = model.invoke(model_input)
    finally:
        CURRENT_AGENT_CONTEXT.reset(context_token)
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


def run_agent(
    user_id: str,
    thread_id: str,
    message: str,
    auth_user_id: Optional[str] = None,
    motivation: int = 50,
) -> Dict[str, Any]:
    config = {"configurable": {"thread_id": thread_id}}
    # This initial state is the first packet given to the graph for the current turn.
    # MemorySaver uses thread_id to stitch this turn together with prior turns.
    initial_state: AgentState = {
        "messages": [HumanMessage(content=message)],
        "user_id": user_id,
        "auth_user_id": auth_user_id,
        "motivation": motivation,
        "user_metadata": {},
    }
    context_token = CURRENT_AGENT_CONTEXT.set(
        {
            "user_id": user_id,
            "auth_user_id": auth_user_id,
            "motivation": motivation,
            "user_metadata": {},
        }
    )
    try:
        result = graph.invoke(initial_state, config=config)
    finally:
        CURRENT_AGENT_CONTEXT.reset(context_token)

    final_text = ""
    for agent_message in reversed(result["messages"]):
        if isinstance(agent_message, AIMessage) and agent_message.content:
            if isinstance(agent_message.content, str):
                final_text = agent_message.content
            else:
                final_text = str(agent_message.content)
            break

    return {"response": final_text, "state": result}
