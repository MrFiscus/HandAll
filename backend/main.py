import logging
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from dotenv import load_dotenv

ROOT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ROOT_ENV_FILE, override=True)

if not os.getenv("SUPABASE_KEY") and os.getenv("SUPABASE_ANON_KEY"):
    os.environ["SUPABASE_KEY"] = os.environ["SUPABASE_ANON_KEY"]

logger = logging.getLogger(__name__)


def _expose_internal_errors() -> bool:
    """Short technical errors in API/body when debugging (set in root .env)."""
    v = (
        os.getenv("HANDALL_EXPOSE_ERRORS")
        or os.getenv("DEBUG")
        or ""
    ).strip().lower()
    return v in ("1", "true", "yes", "on")


def _failure_frame(exc: BaseException) -> str:
    """Best-effort location of the raising frame."""
    if exc.__traceback__ is None:
        return "unknown"
    frames = traceback.extract_tb(exc.__traceback__)
    if not frames:
        return "unknown"
    last = frames[-1]
    return f"{last.filename}:{last.lineno} in {last.name}"


def classify_chat_exception(exc: BaseException) -> str:
    """
    Rough bucket for support: llm (Gemini / API), tool (HandAll tools), graph (LangGraph), other.
    """
    try:
        from google.api_core import exceptions as google_api_exceptions
    except ImportError:
        google_api_exceptions = None  # type: ignore

    root = exc
    while root.__cause__ is not None:
        root = root.__cause__

    checked: list[BaseException] = [exc, root] if root is not exc else [exc]
    for e in checked:
        mod = (type(e).__module__ or "").lower()
        name = type(e).__name__
        if google_api_exceptions and isinstance(e, google_api_exceptions.GoogleAPIError):
            return "llm"
        if (
            mod.startswith("google.genai")
            or "langchain_google_genai" in mod
            or "google.api_core" in mod
            or mod.startswith("openai.")
            or "langchain_openai" in mod
        ):
            return "llm"
        if name in ("APIError", "APIConnectionError", "RateLimitError", "AuthenticationError"):
            if "openai" in mod:
                return "llm"
        if "langgraph" in mod or "langgraph" in name.lower():
            return "graph"
        if "langchain_core.tools" in mod or name in ("ToolException",):
            return "tool"

    blob = f"{type(exc).__name__} {type(root).__name__} {exc!s} {root!s}".lower()
    if (
        "rate_limit" in blob
        or "rate limit" in blob
        or "429" in blob
        or "resource exhausted" in blob
        or "resource_exhausted" in blob
        or "insufficient_quota" in blob
        or "too many requests" in blob
        or "incorrect api key" in blob
        or "invalid_api_key" in blob
        or "api key not valid" in blob
        or "generativelanguage.googleapis.com" in blob
        or (
            "gemini" in blob
            and (
                "quota" in blob
                or "limit" in blob
                or "permission" in blob
                or "unauthorized" in blob
            )
        )
    ):
        return "llm"
    if "tool" in blob and ("invoke" in blob or "toolnode" in blob):
        return "tool"

    if exc.__traceback__:
        _agent_tool_names = {
            "list_events",
            "manage_event",
            "list_schedule",
            "search_app_tasks",
            "update_app_task_times",
            "move_app_task_local",
            "add_app_task",
            "remove_app_task",
            "rebalance_app_plan",
        }
        for fr in traceback.extract_tb(exc.__traceback__):
            if fr.name in _agent_tool_names:
                return "tool"
            if fr.name == "call_model":
                return "llm"

    return "other"


def _gemini_error_kind(exc: BaseException) -> Optional[str]:
    """Best-effort: rate_limit | auth | not_found, or None."""
    try:
        from google.api_core import exceptions as g_exc
    except ImportError:
        g_exc = None  # type: ignore

    seen: set[int] = set()
    cur: Optional[BaseException] = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if g_exc:
            if isinstance(cur, g_exc.ResourceExhausted):
                return "rate_limit"
            if isinstance(cur, (g_exc.Unauthenticated, g_exc.PermissionDenied)):
                return "auth"
            if isinstance(cur, g_exc.NotFound):
                return "not_found"
        cur = cur.__cause__
    return None


def build_chat_error_payload(exc: BaseException) -> Tuple[str, Optional[str], Optional[str]]:
    """
    Returns (friendly_or_dev_response_text, error_source, error_detail).

    Always log separately with logger.exception — this only shapes the HTTP body.
    """
    raw = str(exc)
    low = raw.lower()
    source = classify_chat_exception(exc)
    frame = _failure_frame(exc)
    expose = _expose_internal_errors()
    gemini_kind = _gemini_error_kind(exc)

    rate_limited = (
        gemini_kind == "rate_limit"
        or "resource_exhausted" in low
        or "resource exhausted" in low
        or " 429" in raw
        or raw.strip().startswith("429")
        or "quota" in low
        or "insufficient_quota" in low
        or ("rate" in low and "limit" in low)
        or "too many requests" in low
        or "rate_limit" in low
    )
    auth_problem = (
        gemini_kind == "auth"
        or "api key" in low
        or "invalid_api_key" in low
        or "incorrect api key" in low
        or "api key not valid" in low
        or "invalid api" in low
        or "401" in raw
        or "403" in raw
        or ("permission" in low and "denied" in low)
        or "unauthenticated" in low
    )
    model_not_found = (
        gemini_kind == "not_found"
        or ("404" in raw and ("model" in low or "not found" in low))
        or "is not found for api version" in low
        or "was not found" in low and "model" in low
    )

    if rate_limited:
        friendly = (
            "Gemini API rate limit or quota was reached. Wait briefly and try again, or check usage "
            "limits in Google AI Studio / Cloud console for this API key."
        )
    elif auth_problem:
        friendly = (
            "Google API key was rejected or lacks permission. Check `GOOGLE_API_KEY` in the root "
            "`.env` file and that the Generative Language API is enabled for the key's project."
        )
    elif model_not_found:
        friendly = (
            "The configured Gemini model was not found or is not available for this key. "
            "Set `GOOGLE_MODEL` in the root `.env` file to a model your project supports "
            "(default: gemini-2.5-flash)."
        )
    elif source == "llm":
        friendly = (
            "The AI model request failed. Verify `GOOGLE_API_KEY` and `GOOGLE_MODEL` in the root `.env` file "
            "and try again."
        )
    else:
        friendly = (
            "The AI assistant hit an unexpected error. Please try again in a moment. "
            "If it keeps failing, check your API key and network connection."
        )

    detail = (
        f"[{source}] {type(exc).__name__}: {raw[:600]}"
        + (f" | at {frame}" if frame != "unknown" else "")
    )

    if expose:
        src_label = (
            "LLM/API (Gemini)"
            if source == "llm"
            else "tool/graph/app"
            if source in ("tool", "graph")
            else "other"
        )
        text = (
            f"{friendly}\n\n--- debug ---\n"
            f"source={source} ({src_label})\n"
            f"exception={type(exc).__name__}\n"
            f"message={raw[:800]}\n"
            f"location={frame}"
        )
        return text, source, detail[:1200]

    return friendly, source, None


@asynccontextmanager
async def _app_lifespan(app: FastAPI):
    from backend.google_model import DEFAULT_GOOGLE_MODEL
    from backend.llm_client import get_gemini_chat_model

    active_model = os.getenv("GOOGLE_MODEL", DEFAULT_GOOGLE_MODEL)
    key_ok = bool(os.getenv("GOOGLE_API_KEY"))
    logger.info(
        "HandAll AI backend: llm_provider=gemini model=%s GOOGLE_API_KEY_configured=%s",
        active_model,
        key_ok,
    )
    # TEMPORARY startup debug: exact model string bound on ChatGoogleGenerativeAI (remove when stable).
    if key_ok:
        _llm = get_gemini_chat_model(temperature=0.2)
        if _llm is not None:
            bound = getattr(_llm, "model", None) or active_model
            logger.info(
                "HandAll AI backend [debug]: gemini_runtime_model=%s (from ChatGoogleGenerativeAI.model)",
                bound,
            )
    yield


app = FastAPI(title="HandAll AI Agent Backend", lifespan=_app_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    user_id: str
    thread_id: str
    message: str
    auth_user_id: str | None = None
    motivation: int = 50


class ChatResponse(BaseModel):
    response: str
    user_id: str
    thread_id: str
    schedule_updated: bool = Field(
        default=False,
        description="True when HandAll SQLite tasks changed; client should refetch /api/tasks.",
    )
    error_source: Optional[str] = Field(
        default=None,
        description="On /chat failure: llm | tool | graph | other (best-effort).",
    )
    error_detail: Optional[str] = Field(
        default=None,
        description="Short technical summary when HANDALL_EXPOSE_ERRORS or DEBUG is enabled.",
    )


class ProfileSyncRequest(BaseModel):
    user_id: str
    name: str = "Student"
    timezone: str = "UTC"
    prefs: Dict[str, Any]


class PlannerEvent(BaseModel):
    id: str
    title: str
    start: str
    end: str
    type: str
    description: str = ""
    completed: bool = False
    sourceUrl: str | None = None


class PlannerAssignment(BaseModel):
    id: str | None = None
    title: str
    description: str = ""
    due_date: str | None = None
    estimated_hours: float | None = None


class PlannerWorkUnit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    assignment_id: str = ""
    assignment_title: str = ""
    title: str = ""
    description: str = ""
    estimated_minutes: int = 45
    sort_order: int = 0
    due_iso: str | None = None


class PlannerGoalWorkUnit(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    title: str = ""
    description: str = ""
    estimated_minutes: int = 40
    side_goal: str = ""
    sort_order: int = 0


class WeeklyPlanRequest(BaseModel):
    user_id: str = "student"
    name: str = "Student"
    timezone: str = "UTC"
    wake_time: str = "07:00"
    sleep_time: str = "23:00"
    side_goals: list[str] = []
    motivation: int = 50
    horizon_days: int = 7
    events: list[PlannerEvent] = []
    assignments: list[PlannerAssignment] = []
    assignment_work_units: list[PlannerWorkUnit] = []
    goal_work_units: list[PlannerGoalWorkUnit] = []


class AssignmentSubtasksRequest(BaseModel):
    parent_title: str
    parent_description: str = ""
    due_date_iso: str | None = None
    motivation: int = 50


class GoalTasksRequest(BaseModel):
    side_goals: list[str] = []
    motivation: int = 50


class GoalEventCandidate(BaseModel):
    title: str = ""
    description: str = ""
    url: str = ""
    kind: str = "fun"
    goal: str | None = None


class GoalEventGroupInput(BaseModel):
    goal: str
    query: str = ""
    results: list[GoalEventCandidate] = []


class GoalEventRecommendationsRequest(BaseModel):
    location: str
    side_goals: list[str] = []
    motivation: int = 50
    fun_events: list[GoalEventCandidate] = []
    goal_event_groups: list[GoalEventGroupInput] = []


class BatchAssignmentInput(BaseModel):
    assignment_key: str
    title: str
    description: str = ""
    due_date_iso: str | None = None


class AssignmentSubtasksBatchRequest(BaseModel):
    assignments: list[BatchAssignmentInput]
    motivation: int = 50


class ClassifyEventInput(BaseModel):
    id: str
    title: str = ""
    description: str = ""
    start: str = ""
    end: str = ""


class ClassifyEventsRequest(BaseModel):
    events: list[ClassifyEventInput]


@app.get("/")
def root() -> Dict[str, str]:
    return {"message": "HandAll AI backend is running", "docs": "/docs"}


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/profile/sync")
def sync_profile(request: ProfileSyncRequest) -> Dict[str, Any]:
    try:
        from backend.agent import upsert_user_profile

        profile = upsert_user_profile(
            user_id=request.user_id,
            name=request.name,
            timezone_name=request.timezone,
            prefs=request.prefs,
        )
        return {"success": True, "profile": profile}
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "profile": {
                "id": request.user_id,
                "name": request.name,
                "timezone": request.timezone,
                "prefs": request.prefs,
            },
        }


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> Dict[str, Any]:
    schedule_updated = False
    error_source: Optional[str] = None
    error_detail: Optional[str] = None
    try:
        if not os.getenv("GOOGLE_API_KEY"):
            result = {
                "response": (
                    "The AI backend is connected, but `GOOGLE_API_KEY` is not configured yet. "
                    "Add it to the root `.env` file to enable Gemini (and optionally `GOOGLE_MODEL`)."
                )
            }
        else:
            from backend.agent import run_agent

            result = run_agent(
                user_id=request.user_id,
                thread_id=request.thread_id,
                message=request.message,
                auth_user_id=request.auth_user_id,
                motivation=request.motivation,
            )
            schedule_updated = bool(result.get("schedule_updated"))
    except Exception as exc:
        logger.exception(
            "POST /chat failed (thread_id=%s user_id=%s)",
            request.thread_id,
            request.user_id,
        )
        response_text, error_source, error_detail = build_chat_error_payload(exc)
        result = {"response": response_text}
        schedule_updated = False
    return {
        "response": result["response"],
        "user_id": request.user_id,
        "thread_id": request.thread_id,
        "schedule_updated": schedule_updated,
        "error_source": error_source,
        "error_detail": error_detail,
    }


@app.post("/plan-week")
def plan_week(request: WeeklyPlanRequest) -> Dict[str, Any]:
    try:
        from backend.planner import generate_weekly_plan

        result = generate_weekly_plan(
            {
                "user_id": request.user_id,
                "name": request.name,
                "timezone": request.timezone,
                "wake_time": request.wake_time,
                "sleep_time": request.sleep_time,
                "side_goals": request.side_goals,
                "motivation": request.motivation,
                "horizon_days": request.horizon_days,
                "events": [event.model_dump() for event in request.events],
                "assignments": [assignment.model_dump() for assignment in request.assignments],
                "assignment_work_units": [u.model_dump(exclude_none=True) for u in request.assignment_work_units],
                "goal_work_units": [u.model_dump(exclude_none=True) for u in request.goal_work_units],
            }
        )
        return {"success": True, **result}
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "assignments": [],
            "suggested_tasks": [],
            "meta": {},
        }


@app.post("/ai/assignment-subtasks")
def ai_assignment_subtasks(request: AssignmentSubtasksRequest) -> Dict[str, Any]:
    try:
        from backend.task_generation import generate_assignment_subtasks

        subtasks = generate_assignment_subtasks(
            request.parent_title,
            request.parent_description,
            request.due_date_iso,
            request.motivation,
        )
        return {"success": True, "subtasks": subtasks}
    except Exception as exc:
        return {"success": False, "error": str(exc), "subtasks": []}


@app.post("/ai/classify-events")
def ai_classify_events(request: ClassifyEventsRequest) -> Dict[str, Any]:
    """AI-only event classification (protected vs deadline vs flexible)."""
    try:
        from backend.calendar_intelligence import classify_calendar_events_batch

        evs = [e.model_dump() for e in request.events]
        results = classify_calendar_events_batch(evs)
        return {"success": True, "results": results}
    except Exception as exc:
        return {"success": False, "error": str(exc), "results": []}


@app.post("/ai/assignment-subtasks-batch")
def ai_assignment_subtasks_batch(request: AssignmentSubtasksBatchRequest) -> Dict[str, Any]:
    try:
        from backend.task_generation import generate_assignments_subtasks_batch

        items = []
        for a in request.assignments:
            d = a.model_dump(exclude_none=True)
            if d.get("assignment_key") and d.get("title"):
                items.append(d)
        batch = generate_assignments_subtasks_batch(items, request.motivation)
        results = [{"assignment_key": k, "subtasks": v} for k, v in batch.items()]
        return {"success": True, "results": results}
    except Exception as exc:
        return {"success": False, "error": str(exc), "results": []}


@app.post("/ai/goal-tasks")
def ai_goal_tasks(request: GoalTasksRequest) -> Dict[str, Any]:
    try:
        from backend.task_generation import generate_goal_tasks

        tasks = generate_goal_tasks(request.side_goals, request.motivation)
        return {"success": True, "tasks": tasks}
    except Exception as exc:
        return {"success": False, "error": str(exc), "tasks": []}


@app.post("/ai/recommend-goal-events")
def ai_recommend_goal_events(request: GoalEventRecommendationsRequest) -> Dict[str, Any]:
    try:
        from backend.planner import recommend_goal_events

        recommendations = recommend_goal_events(
            {
                "location": request.location,
                "side_goals": request.side_goals,
                "motivation": request.motivation,
                "fun_events": [event.model_dump() for event in request.fun_events],
                "goal_event_groups": [group.model_dump() for group in request.goal_event_groups],
            }
        )
        return {"success": True, **recommendations}
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "fun_event": None,
            "goal_event": None,
        }
