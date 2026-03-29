import logging
import os
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from dotenv import load_dotenv

ROOT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ROOT_ENV_FILE, override=True)

# Ensure HandAll + uvicorn show INFO logs (OPENAI CALL START, POST /chat path lines).
_log_name = (os.getenv("LOG_LEVEL") or "INFO").upper()
_log_level = getattr(logging, _log_name, logging.INFO)
if not logging.root.handlers:
    logging.basicConfig(level=_log_level, format="%(levelname)s:%(name)s:%(message)s")
else:
    logging.root.setLevel(_log_level)
for _name in ("backend", "uvicorn", "uvicorn.error", "uvicorn.access"):
    logging.getLogger(_name).setLevel(_log_level)

# TEMP: remove after debugging — confirms which process loads .env (logger so it always shows under uvicorn)
_k = os.getenv("OPENAI_API_KEY") or ""
_pref = _k[:10] if len(_k) >= 10 else _k
logging.getLogger(__name__).info("OPENAI KEY PREFIX (TEMP): %s", _pref)
print("OPENAI KEY PREFIX:", _pref, flush=True)

if not os.getenv("SUPABASE_KEY") and os.getenv("SUPABASE_ANON_KEY"):
    os.environ["SUPABASE_KEY"] = os.environ["SUPABASE_ANON_KEY"]

logger = logging.getLogger(__name__)


def _get_supabase_auth_client():
    """Minimal Supabase client for JWT validation (same project as Node /api/tasks)."""
    from supabase import create_client

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY") or os.getenv("SUPABASE_ANON_KEY")
    if not url or not key:
        return None
    return create_client(url, key)


def _auth_user_id_from_jwt(token: str) -> Optional[str]:
    client = _get_supabase_auth_client()
    if not client:
        return None
    try:
        res = client.auth.get_user(token)
        if res is None:
            return None
        user = getattr(res, "user", None)
        if user is not None:
            uid = getattr(user, "id", None)
            if uid:
                return str(uid)
    except Exception as exc:
        logger.warning("chat auth: supabase.auth.get_user failed: %s", exc)
        return None
    return None


def _resolve_chat_auth_user(
    authorization: Optional[str],
    body_auth_user_id: Optional[str],
) -> Optional[str]:
    """
    Prefer Authorization: Bearer <Supabase access_token> (validated via Supabase Auth).
    Fall back to JSON auth_user_id only when no Bearer token is sent.
    """
    if authorization:
        raw = authorization.strip()
        if raw.lower().startswith("bearer "):
            token = raw[7:].strip()
            if token:
                uid = _auth_user_id_from_jwt(token)
                if uid:
                    return uid
                logger.warning("POST /chat: Bearer token did not validate")
                raise HTTPException(
                    status_code=401,
                    detail="Invalid or expired session. Please sign in again.",
                )
    if body_auth_user_id:
        logger.warning("POST /chat: using auth_user_id from JSON (no Bearer token)")
        return str(body_auth_user_id).strip() or None
    return None


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
    Rough bucket for support: llm (OpenAI / API), tool (HandAll tools), graph (LangGraph), other.
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


def _llm_provider_error_kind(exc: BaseException) -> Optional[str]:
    """Best-effort: rate_limit | auth | not_found (OpenAI first; Google API core as legacy)."""
    try:
        import openai

        seen: set[int] = set()
        cur: Optional[BaseException] = exc
        while cur is not None and id(cur) not in seen:
            seen.add(id(cur))
            if isinstance(cur, openai.RateLimitError):
                return "rate_limit"
            if isinstance(cur, openai.AuthenticationError):
                return "auth"
            if isinstance(cur, openai.NotFoundError):
                return "not_found"
            if isinstance(cur, openai.BadRequestError):
                low = str(cur).lower()
                if "model" in low and ("not found" in low or "does not exist" in low or "invalid" in low):
                    return "not_found"
            cur = cur.__cause__
    except ImportError:
        pass

    try:
        from google.api_core import exceptions as g_exc
    except ImportError:
        g_exc = None  # type: ignore

    seen2: set[int] = set()
    cur2: Optional[BaseException] = exc
    while cur2 is not None and id(cur2) not in seen2:
        seen2.add(id(cur2))
        if g_exc:
            if isinstance(cur2, g_exc.ResourceExhausted):
                return "rate_limit"
            if isinstance(cur2, (g_exc.Unauthenticated, g_exc.PermissionDenied)):
                return "auth"
            if isinstance(cur2, g_exc.NotFound):
                return "not_found"
        cur2 = cur2.__cause__
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
    llm_kind = _llm_provider_error_kind(exc)

    rate_limited = (
        llm_kind == "rate_limit"
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
        llm_kind == "auth"
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
        llm_kind == "not_found"
        or ("404" in raw and ("model" in low or "not found" in low))
        or "is not found for api version" in low
        or "was not found" in low and "model" in low
    )

    if rate_limited:
        friendly = (
            "OpenAI API rate limit or quota was reached. Wait briefly and try again, or check usage "
            "limits in your OpenAI account dashboard."
        )
    elif auth_problem:
        friendly = (
            "OpenAI API key was rejected or lacks permission. Check `OPENAI_API_KEY` in the root "
            "`.env` file."
        )
    elif model_not_found:
        friendly = (
            "The configured OpenAI model was not found or is not available for this key. "
            "Set `OPENAI_MODEL` in the root `.env` file (default: gpt-4o-mini)."
        )
    elif source == "llm":
        friendly = (
            "The AI model request failed. Verify `OPENAI_API_KEY` and `OPENAI_MODEL` in the root `.env` file "
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
            "LLM/API (OpenAI)"
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


def user_safe_error_message(exc: BaseException) -> str:
    """User-facing message for JSON responses (same shaping as /chat; no raw API dumps unless debug env)."""
    text, _, _ = build_chat_error_payload(exc)
    return text


@asynccontextmanager
async def _app_lifespan(app: FastAPI):
    from backend.llm_client import get_openai_chat_model
    from backend.openai_model import DEFAULT_OPENAI_MODEL

    active_model = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    key_ok = bool(os.getenv("OPENAI_API_KEY"))
    logger.info(
        "HandAll AI backend: llm_provider=openai model=%s OPENAI_API_KEY_configured=%s",
        active_model,
        key_ok,
    )
    if key_ok:
        _llm = get_openai_chat_model(temperature=0.2)
        if _llm is not None:
            bound = (
                getattr(_llm, "model_name", None)
                or getattr(_llm, "model", None)
                or active_model
            )
            logger.info("HandAll AI backend: openai_runtime_model=%s", bound)
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
    scheduling_prefs: dict[str, Any] | None = None


class AssignmentSubtasksRequest(BaseModel):
    parent_title: str
    parent_description: str = ""
    due_date_iso: str | None = None
    motivation: int = 50


class GoalTasksRequest(BaseModel):
    side_goals: list[str] = []
    motivation: int = 50


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
def chat(
    request: ChatRequest,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> Dict[str, Any]:
    schedule_updated = False
    error_source: Optional[str] = None
    error_detail: Optional[str] = None
    out_chat_path: Optional[str] = None
    openai_agent_chat = False

    auth_user_id: Optional[str]
    try:
        auth_user_id = _resolve_chat_auth_user(authorization, request.auth_user_id)
    except HTTPException:
        raise

    effective_profile_id = auth_user_id or request.user_id
    logger.info(
        "POST /chat: user_id_param=%s resolved_auth_user_id=%s effective_profile_id=%s",
        request.user_id,
        auth_user_id,
        effective_profile_id,
    )

    if auth_user_id:
        try:
            from backend.agent import _fetch_user_assignment_tasks, _resolve_local_user

            lu = _resolve_local_user(auth_user_id, None)
            if lu:
                acount = len(_fetch_user_assignment_tasks(int(lu["id"])))
                logger.info(
                    "POST /chat: local_user_id=%s assignment_tasks_in_db=%s",
                    lu["id"],
                    acount,
                )
            else:
                logger.info(
                    "POST /chat: no SQLite users row for auth_user_id=%s (first visit)",
                    auth_user_id,
                )
        except Exception as exc:
            logger.warning("POST /chat: assignment count log failed: %s", exc)

    try:
        if not os.getenv("OPENAI_API_KEY"):
            logger.warning(
                "POST /chat: OPENAI NOT CALLED — fallback (reason=no OPENAI_API_KEY; agent not started)",
            )
            result = {
                "response": (
                    "The AI backend is connected, but `OPENAI_API_KEY` is not configured yet. "
                    "Add it to the root `.env` file (and optionally `OPENAI_MODEL`, default gpt-4o-mini)."
                )
            }
        else:
            from backend.agent import run_agent

            result = run_agent(
                user_id=effective_profile_id,
                thread_id=request.thread_id,
                message=request.message,
                auth_user_id=auth_user_id,
                motivation=request.motivation,
            )
            schedule_updated = bool(result.get("schedule_updated"))
            chat_path = str(result.get("chat_path") or "")
            out_chat_path = chat_path or None
            openai_agent_chat = chat_path == "llm"
            if chat_path == "fast_path":
                logger.info(
                    "POST /chat: FAST PATH — no OpenAI call (agent.call_model skipped; "
                    "see OPENAI CALL START only if another module e.g. subtasks invoked OpenAI)"
                )
            elif chat_path == "llm":
                logger.info("POST /chat: LLM PATH — OpenAI chat (expect OPENAI CALL START site=agent.call_model)")
            else:
                logger.warning(
                    "POST /chat: OPENAI NOT CALLED — fallback (unexpected chat_path=%r; graph state incomplete?)",
                    chat_path,
                )
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
        "user_id": effective_profile_id,
        "thread_id": request.thread_id,
        "schedule_updated": schedule_updated,
        "chat_path": out_chat_path,
        "openai_agent_chat": openai_agent_chat,
        "error_source": error_source,
        "error_detail": error_detail,
    }


def _test_openai_direct_enabled() -> bool:
    v = (os.getenv("HANDALL_CHAT_TEST_OPENAI") or "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    # Same flag used elsewhere for dev diagnostics — avoids extra env churn.
    return (os.getenv("HANDALL_EXPOSE_ERRORS") or "").strip() in ("1", "true", "yes", "on")


@app.post("/chat/test-openai-direct")
def chat_test_openai_direct() -> Dict[str, Any]:
    """
    Dev test: bypass agent graph and invoke OpenAI once.
    Enable with HANDALL_CHAT_TEST_OPENAI=1 or HANDALL_EXPOSE_ERRORS=1 in root `.env`.
    Log lines: OPENAI CALL START … OPENAI CALL DONE …
    """
    if not _test_openai_direct_enabled():
        raise HTTPException(
            status_code=404,
            detail="Enable with HANDALL_CHAT_TEST_OPENAI=1 or HANDALL_EXPOSE_ERRORS=1",
        )
    if not os.getenv("OPENAI_API_KEY"):
        logger.warning("OPENAI NOT CALLED — fallback site=POST /chat/test-openai-direct reason=no OPENAI_API_KEY")
        return {"ok": False, "error": "OPENAI_API_KEY not set"}
    from langchain_core.messages import HumanMessage

    from backend.llm_client import get_openai_chat_model
    from backend.llm_usage import invoke_openai_chat

    logger.info("POST /chat/test-openai-direct: forcing OpenAI (bypass fast path)")
    model = get_openai_chat_model(temperature=0)
    if model is None:
        logger.warning("OPENAI NOT CALLED — fallback site=test-openai-direct reason=model_unavailable")
        return {"ok": False, "error": "get_openai_chat_model returned None"}
    response = invoke_openai_chat(
        model,
        [HumanMessage(content='Reply with exactly: OPENAI_TEST_OK')],
        "debug.test_openai_direct",
    )
    text = str(getattr(response, "content", "") or "")
    return {"ok": True, "reply_preview": text[:200]}


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
                "scheduling_prefs": request.scheduling_prefs,
            }
        )
        return {"success": True, **result}
    except Exception as exc:
        logger.exception("POST /plan-week failed")
        return {
            "success": False,
            "error": user_safe_error_message(exc),
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
        logger.exception("POST /ai/assignment-subtasks failed")
        return {"success": False, "error": user_safe_error_message(exc), "subtasks": []}


@app.post("/ai/classify-events")
def ai_classify_events(request: ClassifyEventsRequest) -> Dict[str, Any]:
    """AI-only event classification (protected vs deadline vs flexible)."""
    try:
        from backend.calendar_intelligence import classify_calendar_events_batch

        evs = [e.model_dump() for e in request.events]
        results = classify_calendar_events_batch(evs)
        return {"success": True, "results": results}
    except Exception as exc:
        logger.exception("POST /ai/classify-events failed")
        return {"success": False, "error": user_safe_error_message(exc), "results": []}


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
        logger.exception("POST /ai/assignment-subtasks-batch failed")
        return {"success": False, "error": user_safe_error_message(exc), "results": []}


@app.post("/ai/goal-tasks")
def ai_goal_tasks(request: GoalTasksRequest) -> Dict[str, Any]:
    try:
        from backend.task_generation import generate_goal_tasks

        tasks = generate_goal_tasks(request.side_goals, request.motivation)
        return {"success": True, "tasks": tasks}
    except Exception as exc:
        logger.exception("POST /ai/goal-tasks failed")
        return {"success": False, "error": user_safe_error_message(exc), "tasks": []}
