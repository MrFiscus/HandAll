import json
import logging
import os
import re
import sqlite3
from contextvars import ContextVar
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional, Tuple, TypedDict
from zoneinfo import ZoneInfo

from google.oauth2 import service_account
from googleapiclient.discovery import build
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode, tools_condition
from dotenv import load_dotenv
from supabase import Client, create_client

from backend.llm_client import get_gemini_chat_model
from backend.llm_usage import log_llm_chat_completion
from backend.task_generation import generate_assignment_subtasks


ROOT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
SQLITE_DB_PATH = Path(__file__).resolve().parent / "handall.db"
load_dotenv(ROOT_ENV_FILE)

if not os.getenv("SUPABASE_KEY") and os.getenv("SUPABASE_ANON_KEY"):
    os.environ["SUPABASE_KEY"] = os.environ["SUPABASE_ANON_KEY"]

CURRENT_AGENT_CONTEXT: ContextVar[Dict[str, Any]] = ContextVar("current_agent_context", default={})

logger = logging.getLogger(__name__)


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


def _side_goals_from_user_record(user: Optional[Dict[str, Any]]) -> List[str]:
    if not user:
        return []
    raw = user.get("side_goals_json")
    if raw and isinstance(raw, str):
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return [str(g).strip() for g in data if str(g).strip()]
        except Exception:
            pass
    sg = user.get("side_goal") or ""
    if isinstance(sg, str) and sg.strip():
        return [sg.strip()]
    return []


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


def _safe_zone(tz_name: str) -> ZoneInfo:
    name = (tz_name or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo("UTC")


def _parse_local_date_yyyy_mm_dd(s: str) -> date:
    raw = (s or "").strip()
    parts = raw.split("-")
    if len(parts) != 3:
        raise ValueError(f"Expected local_date as YYYY-MM-DD, got {s!r}")
    y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    return date(y, m, d)


def _parse_local_hhmm(raw: str) -> Tuple[int, int]:
    """Parse times like 2, 2am, 2:00, 14:30, 6:00pm into 24h hour, minute."""
    t = (raw or "").strip().lower().replace(" ", "")
    if not t:
        raise ValueError("Time string is empty")
    m = re.match(r"^(\d{1,2})(?::(\d{2}))?(am|pm)$", t)
    if m:
        h, mi, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3)
        if mi >= 60:
            raise ValueError(f"Invalid minutes in {raw!r}")
        if ap == "am":
            if h == 12:
                h = 0
        else:
            if h != 12:
                h += 12
        return h % 24, mi
    m = re.match(r"^(\d{1,2}):(\d{2})$", t)
    if m:
        h, mi = int(m.group(1)), int(m.group(2))
        if h >= 24 or mi >= 60:
            raise ValueError(f"Invalid time {raw!r}")
        return h % 24, mi
    m = re.match(r"^(\d{1,2})$", t)
    if m:
        return int(m.group(1)) % 24, 0
    raise ValueError(f"Could not parse local time from {raw!r} (use e.g. 2am, 02:00, 14:30)")


def _task_with_local_labels(task: Dict[str, Any], tz_name: str) -> Dict[str, Any]:
    z = _safe_zone(tz_name)
    st = _parse_iso_datetime(task["start"])
    et = _parse_iso_datetime(task["end"])
    return {
        **task,
        "local_start_label": st.astimezone(z).strftime("%Y-%m-%d %H:%M"),
        "local_end_label": et.astimezone(z).strftime("%Y-%m-%d %H:%M"),
    }


def _local_calendar_day_utc_bounds(d: date, tz_name: str) -> Tuple[datetime, datetime]:
    """
    Inclusive start / exclusive end in UTC for the user's local calendar day `d`.
    Used to query SQLite where task times are stored as UTC ISO strings.
    """
    z = _safe_zone(tz_name)
    local_start = datetime.combine(d, time(0, 0, 0), tzinfo=z)
    local_end = local_start + timedelta(days=1)
    utc_start = local_start.astimezone(timezone.utc)
    utc_end = local_end.astimezone(timezone.utc)
    return utc_start, utc_end


def _fetch_tasks_starting_on_local_calendar_day(
    local_user_id: int, d: date, tz_name: str
) -> List[Dict[str, Any]]:
    """
    All tasks whose start falls on local calendar day `d` (any time of day), including
    tasks that already ended earlier that day (unlike _get_upcoming_tasks which drops past events).
    """
    utc_lo, utc_hi = _local_calendar_day_utc_bounds(d, tz_name)
    lo_iso = utc_lo.isoformat()
    hi_iso = utc_hi.isoformat()
    logger.info(
        "tasks_for_local_day: user_id=%s local_date=%s tz=%s utc_window=[%s, %s)",
        local_user_id,
        d.isoformat(),
        tz_name,
        lo_iso,
        hi_iso,
    )
    with _open_app_db() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND start_time >= ?
              AND start_time < ?
            ORDER BY start_time ASC
            """,
            (local_user_id, lo_iso, hi_iso),
        ).fetchall()
    return [_serialize_task_row(row) for row in rows]


def _tasks_starting_on_local_date(
    local_user_id: int, d: date, tz_name: str, horizon_days: int = 120
) -> List[Dict[str, Any]]:
    """Tasks whose start time falls on local date `d` (timezone-aware DB query)."""
    _ = horizon_days  # retained for call-site compatibility; day scope uses full local calendar day
    return _fetch_tasks_starting_on_local_calendar_day(local_user_id, d, tz_name)


def _match_tasks_for_local_time(
    candidates: List[Dict[str, Any]],
    d: date,
    tz_name: str,
    local_time_hhmm: str,
    tolerance_minutes: int,
) -> List[Dict[str, Any]]:
    z = _safe_zone(tz_name)
    h, mi = _parse_local_hhmm(local_time_hhmm)
    # User intent: wall-clock time in their profile timezone — never interpret as UTC.
    target_local = datetime.combine(d, time(h, mi, 0), tzinfo=z)
    target_utc = target_local.astimezone(timezone.utc)
    tol = max(5, min(int(tolerance_minutes or 90), 24 * 60))
    matched: List[Dict[str, Any]] = []
    logger.info(
        "task_time_match: tz=%s local_date=%s user_local_time=%s (%02d:%02d) -> utc=%s tol_min=%s candidates=%s",
        tz_name,
        d.isoformat(),
        local_time_hhmm,
        h,
        mi,
        target_utc.isoformat(),
        tol,
        len(candidates),
    )
    for t in candidates:
        st = _parse_iso_datetime(t["start"])
        st_local = st.astimezone(z)
        delta = abs((st_local - target_local).total_seconds())
        logger.info(
            "task_time_match: task_id=%s start_utc=%s start_local=%s delta_sec=%s",
            t.get("id"),
            st.isoformat(),
            st_local.strftime("%Y-%m-%d %H:%M"),
            delta,
        )
        if delta <= tol * 60:
            matched.append(t)
    return matched


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


def _find_assignment_task(
    local_user_id: int,
    assignment_identifier: str,
    *,
    days: int = 60,
) -> Tuple[Optional[sqlite3.Row], List[sqlite3.Row], Optional[str]]:
    token = (assignment_identifier or "").strip()
    if not token:
        return None, [], "assignment_identifier is required."

    horizon_days = max(1, min(int(days or 60), 180))
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=horizon_days)).isoformat()

    with _open_app_db() as connection:
        direct = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND type = 'assignment'
              AND end_time >= ?
              AND start_time <= ?
              AND (CAST(id AS TEXT) = ? OR external_id = ?)
            ORDER BY start_time ASC
            """,
            (local_user_id, now_iso, horizon_iso, token, token),
        ).fetchall()
        if direct:
            row = direct[0]
            return row, [row], None

        like = f"%{token.lower()}%"
        matches = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND type = 'assignment'
              AND end_time >= ?
              AND start_time <= ?
              AND LOWER(title) LIKE ?
            ORDER BY start_time ASC
            """,
            (local_user_id, now_iso, horizon_iso, like),
        ).fetchall()

    if not matches:
        return None, [], f"No assignment found matching {token!r}."
    if len(matches) > 1:
        return None, matches, f"Several assignments matched {token!r}; ask the user to be more specific."
    return matches[0], matches, None


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
def search_app_tasks(
    local_date_yyyy_mm_dd: str,
    local_time_hhmm: Optional[str] = None,
    title_contains: Optional[str] = None,
    tolerance_minutes: int = 90,
) -> Dict[str, Any]:
    """
    Find HandAll tasks on a calendar day in the user's timezone.
    Use local_date_yyyy_mm_dd as YYYY-MM-DD (infer year from context: today / schedule snapshot).
    If local_time_hhmm is set (e.g. 2am, 02:00, 14:30), only returns tasks whose start is within tolerance_minutes.
    Optional title_contains filters by substring match (case-insensitive).
    """
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can search the schedule.",
            "matches": [],
        }
    tz_name = context.get("user_metadata", {}).get("timezone") or "UTC"
    try:
        d = _parse_local_date_yyyy_mm_dd(local_date_yyyy_mm_dd)
    except ValueError as e:
        return {"success": False, "message": str(e), "matches": []}

    on_day = _tasks_starting_on_local_date(int(local_user["id"]), d, tz_name)
    logger.info(
        "search_app_tasks: local_date=%s tz=%s tasks_on_day=%s",
        local_date_yyyy_mm_dd,
        tz_name,
        len(on_day),
    )
    title_f = (title_contains or "").strip().lower()
    if title_f:
        on_day = [t for t in on_day if title_f in (t.get("title") or "").lower()]

    if local_time_hhmm and str(local_time_hhmm).strip():
        try:
            matches = _match_tasks_for_local_time(
                on_day, d, tz_name, str(local_time_hhmm).strip(), tolerance_minutes
            )
        except ValueError as e:
            return {"success": False, "message": str(e), "matches": []}
    else:
        matches = list(on_day)

    enriched = [_task_with_local_labels(t, tz_name) for t in matches[:25]]
    return {
        "success": True,
        "timezone": tz_name,
        "local_date": local_date_yyyy_mm_dd,
        "count": len(enriched),
        "matches": enriched,
    }


@tool
def list_assignment_plans(
    assignment_title_contains: str = "",
    days: int = 30,
) -> Dict[str, Any]:
    """List upcoming assignments and any generated subtasks already saved for them."""
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can inspect assignments.",
            "assignments": [],
        }

    safe_days = max(1, min(int(days or 30), 90))
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=safe_days)).isoformat()
    title_filter = f"%{(assignment_title_contains or '').strip().lower()}%"

    with _open_app_db() as connection:
        if (assignment_title_contains or "").strip():
            assignment_rows = connection.execute(
                """
                SELECT *
                FROM tasks
                WHERE user_id = ?
                  AND type = 'assignment'
                  AND end_time >= ?
                  AND start_time <= ?
                  AND LOWER(title) LIKE ?
                ORDER BY start_time ASC
                """,
                (local_user["id"], now_iso, horizon_iso, title_filter),
            ).fetchall()
        else:
            assignment_rows = connection.execute(
                """
                SELECT *
                FROM tasks
                WHERE user_id = ?
                  AND type = 'assignment'
                  AND end_time >= ?
                  AND start_time <= ?
                ORDER BY start_time ASC
                """,
                (local_user["id"], now_iso, horizon_iso),
            ).fetchall()

        planning_rows = connection.execute(
            """
            SELECT *
            FROM ai_planning_items
            WHERE user_id = ?
              AND item_type = 'assignment_task'
            ORDER BY assignment_external_id, sort_order ASC, id ASC
            """,
            (local_user["id"],),
        ).fetchall()

    planning_by_assignment: Dict[str, List[Dict[str, Any]]] = {}
    for row in planning_rows:
        assignment_key = row["assignment_external_id"] or ""
        planning_by_assignment.setdefault(assignment_key, []).append(
            {
                "id": str(row["id"]),
                "title": row["title"],
                "description": row["description"] or "",
                "estimated_minutes": int(row["estimated_minutes"] or 0),
                "sort_order": int(row["sort_order"] or 0),
                "due_iso": row["due_iso"],
            }
        )

    assignments: List[Dict[str, Any]] = []
    for row in assignment_rows:
        external_id = row["external_id"] or f"task:{row['id']}"
        assignments.append(
            {
                "id": str(row["id"]),
                "external_id": external_id,
                "title": row["title"],
                "description": row["description"] or "",
                "start": row["start_time"],
                "end": row["end_time"],
                "subtasks": planning_by_assignment.get(external_id, []),
            }
        )

    return {
        "success": True,
        "days": safe_days,
        "count": len(assignments),
        "assignments": assignments[:20],
    }


@tool
def generate_assignment_plan(assignment_identifier: str) -> Dict[str, Any]:
    """Generate or refresh assignment subtasks for one upcoming assignment in HandAll."""
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can generate assignment subtasks.",
        }

    row, matches, error_message = _find_assignment_task(int(local_user["id"]), assignment_identifier)
    if error_message:
        if matches:
            return {
                "success": False,
                "message": error_message,
                "matches": [
                    {
                        "id": str(match["id"]),
                        "external_id": match["external_id"],
                        "title": match["title"],
                        "start": match["start_time"],
                        "end": match["end_time"],
                    }
                    for match in matches[:10]
                ],
            }
        return {"success": False, "message": error_message, "subtasks": []}

    due_iso = row["start_time"]
    subtasks = generate_assignment_subtasks(
        row["title"],
        row["description"] or "",
        due_iso,
        int(context.get("motivation", 50) or 50),
    )
    assignment_external_id = row["external_id"] or f"task:{row['id']}"

    with _open_app_db() as connection:
        connection.execute(
            """
            DELETE FROM ai_planning_items
            WHERE user_id = ?
              AND item_type = 'assignment_task'
              AND assignment_external_id = ?
            """,
            (local_user["id"], assignment_external_id),
        )
        for index, item in enumerate(subtasks, start=1):
            connection.execute(
                """
                INSERT INTO ai_planning_items (
                    user_id,
                    item_type,
                    assignment_external_id,
                    assignment_title,
                    title,
                    description,
                    estimated_minutes,
                    sort_order,
                    due_iso
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    local_user["id"],
                    "assignment_task",
                    assignment_external_id,
                    row["title"],
                    item["title"],
                    item.get("description", ""),
                    int(item.get("estimated_minutes") or 45),
                    int(item.get("sort_order") or index),
                    due_iso,
                ),
            )
        connection.commit()

    return {
        "success": True,
        "message": f"Generated {len(subtasks)} subtasks for {row['title']}.",
        "assignment": {
            "id": str(row["id"]),
            "external_id": assignment_external_id,
            "title": row["title"],
            "due_iso": due_iso,
        },
        "subtasks": subtasks,
    }


def _reschedule_handall_task(
    local_user: Dict[str, Any],
    task_id: str,
    new_start: datetime,
    new_end: Optional[datetime],
) -> Dict[str, Any]:
    """Apply start/end update in SQLite; shared by update_app_task_times and move_app_task_local."""
    context = _get_agent_context()
    tid = (task_id or "").strip()
    if not tid:
        return {"success": False, "message": "task_id is required."}

    with _open_app_db() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND (CAST(id AS TEXT) = ? OR external_id = ?)
            LIMIT 1
            """,
            (local_user["id"], tid, tid),
        ).fetchone()

        if not row:
            return {
                "success": False,
                "message": f"No task found with id {tid!r}.",
            }

        old_start = _parse_iso_datetime(row["start_time"])
        old_end = _parse_iso_datetime(row["end_time"])
        duration = old_end - old_start
        resolved_end = new_end if new_end is not None else (new_start + duration)
        if resolved_end <= new_start:
            return {
                "success": False,
                "message": "Invalid times: end must be after start.",
            }

        connection.execute(
            """
            UPDATE tasks
            SET start_time = ?, end_time = ?
            WHERE user_id = ? AND id = ?
            """,
            (
                new_start.isoformat(),
                resolved_end.isoformat(),
                local_user["id"],
                row["id"],
            ),
        )
        connection.commit()
        updated = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (row["id"],),
        ).fetchone()

    tz_name = context.get("user_metadata", {}).get("timezone") or "UTC"
    ser = _serialize_task_row(updated) if updated else {}
    if ser:
        ser = _task_with_local_labels(ser, tz_name)
    old_l = _task_with_local_labels(_serialize_task_row(row), tz_name)
    return {
        "success": True,
        "message": (
            f"Moved \"{ser.get('title', '')}\" from {old_l.get('local_start_label')} "
            f"to {ser.get('local_start_label')}."
        ),
        "task": ser,
        "previous_local_start": old_l.get("local_start_label"),
        "new_local_start": ser.get("local_start_label"),
    }


@tool
def update_app_task_times(
    task_id: str,
    new_start_iso_utc: str,
    new_end_iso_utc: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Update a HandAll task's start (and optionally end) time in the app database.
    task_id is the numeric id from search_app_tasks / list_schedule (or external_id).
    Pass new_start_iso_utc / new_end_iso_utc as ISO 8601 instants (with timezone offset, e.g. Z).
    If new_end_iso_utc is omitted, the original duration is preserved.
    """
    ctx = _get_agent_context()
    local_user = _resolve_local_user(ctx.get("auth_user_id"), ctx.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can update tasks.",
        }

    new_start = _parse_iso_datetime(new_start_iso_utc)
    new_end: Optional[datetime] = _parse_iso_datetime(new_end_iso_utc) if new_end_iso_utc else None
    return _reschedule_handall_task(local_user, task_id, new_start, new_end)


@tool
def move_app_task_local(
    local_date_yyyy_mm_dd: str,
    from_local_time_hhmm: str,
    to_local_time_hhmm: str,
    title_contains: str = "",
) -> Dict[str, Any]:
    """
    Move a task on a given local calendar day from one time to another (preserves duration).
    Prefer this when the user gives a date and from-time and to-time (e.g. move Sunday March 29 2am to 6am).
    Do not ask for year or title if the task is uniquely identified. Use title_contains only if needed to disambiguate.
    """
    context = _get_agent_context()
    local_user = _resolve_local_user(context.get("auth_user_id"), context.get("user_metadata"))
    if not local_user:
        return {
            "success": False,
            "message": "I need an authenticated HandAll user before I can move tasks.",
        }
    tz_name = context.get("user_metadata", {}).get("timezone") or "UTC"
    try:
        d = _parse_local_date_yyyy_mm_dd(local_date_yyyy_mm_dd)
    except ValueError as e:
        return {"success": False, "message": str(e)}

    try:
        day_tasks = _tasks_starting_on_local_date(int(local_user["id"]), d, tz_name)
        logger.info(
            "move_app_task_local: local_date=%s tz=%s from=%s to=%s tasks_on_day=%s",
            local_date_yyyy_mm_dd,
            tz_name,
            from_local_time_hhmm,
            to_local_time_hhmm,
            len(day_tasks),
        )
        matches = _match_tasks_for_local_time(
            day_tasks,
            d,
            tz_name,
            from_local_time_hhmm,
            90,
        )
    except ValueError as e:
        return {"success": False, "message": str(e)}

    tcf = (title_contains or "").strip().lower()
    if tcf:
        matches = [t for t in matches if tcf in (t.get("title") or "").lower()]

    if not matches:
        return {
            "success": False,
            "message": (
                f"No task starts near {from_local_time_hhmm!r} on {local_date_yyyy_mm_dd} "
                f"({tz_name}). Use search_app_tasks or list_schedule to see available blocks."
            ),
            "matches": [],
        }
    if len(matches) > 1:
        return {
            "success": False,
            "message": "Multiple tasks match; ask the user to pick one or pass title_contains.",
            "matches": [_task_with_local_labels(t, tz_name) for t in matches[:10]],
        }

    h2, m2 = _parse_local_hhmm(to_local_time_hhmm)
    z = _safe_zone(tz_name)
    new_start = datetime.combine(d, time(h2, m2, 0), tzinfo=z).astimezone(timezone.utc)

    tid = str(matches[0]["id"])
    return _reschedule_handall_task(local_user, tid, new_start, None)


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

        planning_rows = connection.execute(
            """
            SELECT * FROM ai_planning_items
            WHERE user_id = ?
            ORDER BY item_type, assignment_external_id, sort_order, id
            """,
            (local_user["id"],),
        ).fetchall()
        assignment_work_units = []
        goal_work_units = []
        for row in planning_rows:
            r = dict(row)
            if r.get("item_type") == "assignment_subtask":
                assignment_work_units.append(
                    {
                        "id": str(r.get("id")),
                        "assignment_id": r.get("assignment_external_id") or "",
                        "assignment_title": r.get("assignment_title") or "",
                        "title": r.get("title") or "",
                        "description": r.get("description") or "",
                        "estimated_minutes": int(r.get("estimated_minutes") or 45),
                        "sort_order": int(r.get("sort_order") or 0),
                        "due_iso": r.get("due_iso"),
                    }
                )
            elif r.get("item_type") == "goal_task":
                goal_work_units.append(
                    {
                        "id": str(r.get("id")),
                        "title": r.get("title") or "",
                        "description": r.get("description") or "",
                        "estimated_minutes": int(r.get("estimated_minutes") or 40),
                        "side_goal": r.get("side_goal") or "",
                        "sort_order": int(r.get("sort_order") or 0),
                    }
                )

        plan = generate_weekly_plan(
            {
                "user_id": str(local_user["id"]),
                "name": local_user.get("username") or context.get("user_metadata", {}).get("name") or "Student",
                "timezone": timezone_name,
                "wake_time": local_user.get("wake_time") or "07:00",
                "sleep_time": local_user.get("sleep_time") or "23:00",
                "side_goals": _side_goals_from_user_record(local_user),
                "motivation": motivation,
                "horizon_days": safe_days,
                "events": current_events,
                "assignments": [],
                "assignment_work_units": assignment_work_units,
                "goal_work_units": goal_work_units,
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


TOOLS = [
    list_events,
    manage_event,
    list_schedule,
    search_app_tasks,
    list_assignment_plans,
    generate_assignment_plan,
    move_app_task_local,
    update_app_task_times,
    add_app_task,
    remove_app_task,
    rebalance_app_plan,
]


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
        "prefs": dict(profile.get("prefs") or {}),
    }

    auth_uid = state.get("auth_user_id")
    if auth_uid:
        try:
            with _open_app_db() as connection:
                row = connection.execute(
                    """
                    SELECT username, side_goals_json, side_goal, motivation, wake_time, sleep_time
                    FROM users
                    WHERE auth_user_id = ?
                    LIMIT 1
                    """,
                    (auth_uid,),
                ).fetchone()
            if row:
                row_d = dict(row)
                prefs = dict(user_metadata["prefs"])
                goals = _side_goals_from_user_record(row_d)
                prefs["side_goals"] = goals
                prefs["sideGoals"] = goals
                mot = row_d.get("motivation")
                if mot is not None and str(mot).strip() != "":
                    try:
                        prefs["motivation"] = max(0, min(100, int(float(mot))))
                    except (TypeError, ValueError):
                        prefs.setdefault("motivation", 50)
                else:
                    prefs.setdefault("motivation", 50)
                if row_d.get("wake_time"):
                    prefs["wakeTime"] = row_d["wake_time"]
                if row_d.get("sleep_time"):
                    prefs["sleepTime"] = row_d["sleep_time"]
                user_metadata["prefs"] = prefs
                user_metadata["name"] = user_metadata.get("name") or row_d.get("username") or "there"
        except Exception:
            pass

    tzsnap = user_metadata.get("timezone", "UTC")
    z_snap = _safe_zone(tzsnap)
    now_utc = datetime.now(timezone.utc)
    user_metadata["today_local"] = now_utc.astimezone(z_snap).strftime("%Y-%m-%d (%A)")
    snap_lines: List[str] = []
    auth_snap = state.get("auth_user_id")
    if auth_snap:
        lu_snap = _resolve_local_user(auth_snap, user_metadata)
        if lu_snap:
            try:
                for t in _get_upcoming_tasks(int(lu_snap["id"]), 14):
                    st = _parse_iso_datetime(t["start"])
                    local = st.astimezone(z_snap).strftime("%a %Y-%m-%d %H:%M")
                    tit = (t.get("title") or "")[:120]
                    snap_lines.append(f"- id={t['id']} | {local} | {tit}")
            except Exception:
                snap_lines.append("(could not load schedule snapshot)")
    user_metadata["schedule_snapshot"] = (
        "\n".join(snap_lines) if snap_lines else "(no tasks in the next 14 days)"
    )

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
    goals = prefs.get("side_goals") or prefs.get("sideGoals") or []
    if isinstance(goals, str):
        goals = [goals] if goals.strip() else []
    goals_line = json.dumps(goals) if goals else "[]"
    today_local = user_metadata.get("today_local", "")
    schedule_snapshot = user_metadata.get("schedule_snapshot", "(not loaded)")
    return (
        f"You are HandAll's helpful AI planning agent assisting {name}. "
        f"The user's timezone is {timezone_name}. "
        f"Today in that timezone: {today_local}. "
        f"You have access to their HandAll app schedule (stored tasks). "
        f"Current schedule snapshot (next ~14 days, local times):\n{schedule_snapshot}\n"
        f"Current motivation/energy: {motivation}/100 (low = prefer shorter sessions, more rest, lighter tasks; high = can plan deeper work). "
        f"Full side-goals list (use ALL in advice, not just one): {goals_line}. "
        f"Other preferences: {json.dumps({k: v for k, v in prefs.items() if k not in {'side_goals', 'sideGoals'}})}. "
        "Always try to resolve requests using list_schedule, search_app_tasks, or move_app_task_local before asking questions. "
        "If the user asks for help with an assignment, inspect assignment subtasks with list_assignment_plans and generate or refresh them with generate_assignment_plan when needed. "
        "After assignment subtasks exist, use rebalance_app_plan if the user wants actual working blocks placed on the schedule. "
        "For moves like 'move Sunday March 29 2am to 6am', infer the calendar year from Today if the user did not state a year, "
        "use local_date_yyyy_mm_dd (YYYY-MM-DD) in the user's timezone, and call move_app_task_local — do not ask for year or task title "
        "unless no task matches or several tasks match (then use title_contains or list options). "
        "Use HandAll schedule tools to add, remove, move, search, inspect, and rebalance tasks inside the app. "
        "Use the Google Calendar tools only when the user explicitly wants external Google Calendar events inspected or changed. "
        "When you edit the app schedule, state what changed (task title, previous time → new time) in plain language. Be concise and accurate. "
        "Calendar rows may include ai-classification metadata: fixed commitments block time and are not moved by the planner; "
        "assignment deadlines drive AI-generated work blocks scheduled before the due time; flexible events can be overlapped by planned work. "
        "If the user asks why something was classified or how work was split, explain using that distinction and that times for focus blocks come from HandAll's deterministic planner, not guessed by the chat model."
    )


def _parse_tool_message_payload(message: ToolMessage) -> Optional[Dict[str, Any]]:
    raw = message.content
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _merge_schedule_tool_truth(
    messages: List[BaseMessage], assistant_text: str
) -> Tuple[str, bool]:
    """
    Align chat text with actual tool outcomes for schedule-changing tools.
    Returns (merged_response, schedule_changed_in_db).
    """
    fact_lines: List[str] = []
    any_failure = False
    schedule_changed = False

    for message in messages:
        if not isinstance(message, ToolMessage):
            continue
        name = getattr(message, "name", None) or ""
        if name not in {
            "rebalance_app_plan",
            "add_app_task",
            "remove_app_task",
            "update_app_task_times",
            "move_app_task_local",
        }:
            continue
        payload = _parse_tool_message_payload(message)
        if not isinstance(payload, dict):
            continue

        if name == "rebalance_app_plan":
            if payload.get("success"):
                deleted = int(payload.get("deleted_count") or 0)
                inserted = int(payload.get("inserted_count") or 0)
                if deleted > 0 or inserted > 0:
                    schedule_changed = True
                msg = (payload.get("message") or "").strip()
                if deleted == 0 and inserted == 0:
                    fact_lines.append(
                        "HandAll schedule: nothing was changed (no planned blocks to replace in the current window)."
                    )
                elif msg:
                    fact_lines.append(f"HandAll schedule: {msg}")
            else:
                any_failure = True
                fact_lines.append(
                    f"HandAll schedule could not be updated: {payload.get('message', 'Unknown error')}"
                )

        elif name == "add_app_task":
            if payload.get("success"):
                schedule_changed = True
                m = (payload.get("message") or "Task added.").strip()
                fact_lines.append(m)
            else:
                any_failure = True
                fact_lines.append(
                    f"Could not add task: {payload.get('message', 'Unknown error')}"
                )

        elif name == "remove_app_task":
            if payload.get("success"):
                schedule_changed = True
                m = (payload.get("message") or "Task removed.").strip()
                fact_lines.append(m)
            else:
                any_failure = True
                fact_lines.append(
                    f"Could not remove task: {payload.get('message', 'Unknown error')}"
                )

        elif name in ("update_app_task_times", "move_app_task_local"):
            if payload.get("success"):
                schedule_changed = True
                m = (payload.get("message") or "Task updated.").strip()
                if m:
                    fact_lines.append(m)
            else:
                any_failure = True
                fact_lines.append(
                    payload.get("message") or "Could not reschedule task."
                )

    if not fact_lines:
        return assistant_text, schedule_changed

    block = "\n".join(fact_lines)
    if any_failure:
        merged = f"{block}\n\n{assistant_text}".strip() if assistant_text else block
    else:
        merged = f"{assistant_text}\n\n{block}".strip() if assistant_text else block
    return merged, schedule_changed


def _flatten_block_dict(block: Dict[str, Any]) -> str:
    """Extract user-visible text from one structured LangChain/Gemini content block."""
    typ = block.get("type")
    text_val = block.get("text")
    if not isinstance(text_val, str) or not text_val.strip():
        return ""
    if typ in ("image", "file", "tool_use"):
        return ""
    return text_val.strip()


def _flatten_ai_message_content(content: Any) -> str:
    """Gemini/LangChain may return str, a single dict, or a list of blocks."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, dict):
        return _flatten_block_dict(content)
    if isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, str) and block.strip():
                parts.append(block.strip())
            elif isinstance(block, dict):
                piece = _flatten_block_dict(block)
                if piece:
                    parts.append(piece)
        return "\n\n".join(parts).strip()
    return str(content).strip()


def call_model(state: AgentState) -> Dict[str, Any]:
    """Call Gemini with the latest state and let it decide whether to use tools."""
    base = get_gemini_chat_model(temperature=0.2)
    if base is None:
        raise RuntimeError("GOOGLE_API_KEY is not configured in the environment.")
    model = base.bind_tools(TOOLS)

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
        log_llm_chat_completion(response, "agent.call_model")
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

    # Always use the chronologically *last* AIMessage. Skipping messages with falsy
    # content ("" or []) incorrectly picks an *earlier* tool-turn reply (often just "I"
    # or a fragment) instead of the final answer after tools.
    last_ai: Optional[AIMessage] = None
    for agent_message in reversed(result["messages"]):
        if isinstance(agent_message, AIMessage):
            last_ai = agent_message
            break
    final_text = _flatten_ai_message_content(last_ai.content) if last_ai else ""

    final_text, schedule_updated = _merge_schedule_tool_truth(result["messages"], final_text)

    return {"response": final_text, "state": result, "schedule_updated": schedule_updated}
