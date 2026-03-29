import json
import logging
import os
import re
import sqlite3
from contextvars import ContextVar
from datetime import date, datetime, time, timedelta, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Annotated, Any, Dict, List, Literal, NamedTuple, Optional, Tuple, TypedDict
from zoneinfo import ZoneInfo

try:
    from typing import NotRequired
except ImportError:
    from typing_extensions import NotRequired  # type: ignore

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

from backend.llm_client import get_openai_chat_model
from backend.llm_usage import invoke_openai_chat
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
    # Cleared each turn in assignment_intent_handler; True skips LLM for deterministic fast path.
    bypass_llm: NotRequired[bool]


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


def _google_oauth_source_url_from_user_row(ud: Dict[str, Any]) -> str:
    cid = str(ud.get("google_calendar_calendar_id") or "primary").strip() or "primary"
    return f"google-oauth:{cid}"


def _resolve_active_calendar_url(local_user_id: int) -> Tuple[Optional[str], str]:
    """
    Single source of truth for which calendar feeds AI + SQLite task queries.
    Mirrors backend/src/calendarSource.js resolveActiveCalendarSource.
    """
    with _open_app_db() as connection:
        u = connection.execute("SELECT * FROM users WHERE id = ?", (local_user_id,)).fetchone()
        if not u:
            return None, "no_user"
        ud = dict(u)
        src_rows = connection.execute(
            "SELECT url FROM calendar_sources WHERE user_id = ? ORDER BY id ASC",
            (local_user_id,),
        ).fetchall()
    urls: List[str] = []
    for r in src_rows:
        rd = dict(r)
        uu = rd.get("url")
        if uu:
            urls.append(str(uu))
    stored = (ud.get("active_calendar_source_url") or "").strip()
    active: Optional[str] = None
    reason = "none"

    def gurl() -> str:
        return _google_oauth_source_url_from_user_row(ud)

    if stored:
        if stored.startswith("google-oauth:"):
            if ud.get("google_calendar_connected") and stored == gurl():
                active = stored
                reason = "stored"
        elif stored in urls:
            active = stored
            reason = "stored"
    if not active and ud.get("google_calendar_connected"):
        active = gurl()
        reason = "default_google"
    elif not active and urls:
        active = urls[-1]
        reason = "default_last_ics"

    if active:
        logger.info(
            "agent.calendar: active_source=%s resolution=%s user_id=%s",
            active,
            reason,
            local_user_id,
        )
    else:
        logger.info("agent.calendar: no active calendar user_id=%s", local_user_id)
    return active, reason


def _task_row_matches_active_calendar(row: Dict[str, Any], active_url: Optional[str]) -> bool:
    if not active_url:
        return False
    a = str(active_url).strip()
    s = str(row.get("source_url") or "").strip()
    p = str(row.get("planner_source_url") or "").strip()
    return s == a or p == a


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
    active, _ = _resolve_active_calendar_url(local_user_id)
    logger.info(
        "tasks_for_local_day: user_id=%s local_date=%s tz=%s utc_window=[%s, %s) active=%s",
        local_user_id,
        d.isoformat(),
        tz_name,
        lo_iso,
        hi_iso,
        active or "(none)",
    )
    if not active:
        return []
    with _open_app_db() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND start_time >= ?
              AND start_time < ?
              AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
            ORDER BY start_time ASC
            """,
            (local_user_id, lo_iso, hi_iso, active, active),
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
    active, _ = _resolve_active_calendar_url(local_user_id)
    if not active:
        return []
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
              AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
            ORDER BY start_time ASC
            """,
            (local_user_id, now_iso, horizon_iso, active, active),
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

    active, _ = _resolve_active_calendar_url(local_user_id)
    if not active:
        return None, [], "No active calendar source — import an .ics or connect Google Calendar in Settings."

    horizon_days = max(1, min(int(days or 60), 180))
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=horizon_days)).isoformat()

    src_clause = " AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?) "
    sp = (active, active)

    with _open_app_db() as connection:
        direct = connection.execute(
            f"""
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND type = 'assignment'
              AND end_time >= ?
              AND start_time <= ?
              AND (CAST(id AS TEXT) = ? OR external_id = ?)
              {src_clause}
            ORDER BY start_time ASC
            """,
            (local_user_id, now_iso, horizon_iso, token, token) + sp,
        ).fetchall()
        if direct:
            row = direct[0]
            return row, [row], None

        like = f"%{token.lower()}%"
        matches = connection.execute(
            f"""
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND type = 'assignment'
              AND end_time >= ?
              AND start_time <= ?
              AND LOWER(title) LIKE ?
              {src_clause}
            ORDER BY start_time ASC
            """,
            (local_user_id, now_iso, horizon_iso, like) + sp,
        ).fetchall()

    if not matches:
        return None, [], f"No assignment found matching {token!r}."
    if len(matches) > 1:
        return None, matches, f"Several assignments matched {token!r}; ask the user to be more specific."
    return matches[0], matches, None


# --- Planning intent + assignment breakdown (deterministic fast path) ---

_RE_INTENT_BREAKDOWN = re.compile(
    r"\b("
    r"break\s*down|breakdown|subtasks?|"
    r"split\s+(into|it\s+into|the\s+work)|"
    r"decompose|chunk\s+up|work\s*units?|"
    r"step[\s-]by[\s-]step|"
    r"plan\s+(out\s+)?(how\s+to\s+)?(do|finish|write|complete|tackle)|"
    r"plan\s+(my\s+)?(research\s+)?(paper|essay|assignment|project|report)|"
    r"outline\s+(my\s+)?(work|paper)|"
    r"break\s+up\s+the\s+work"
    r")\b",
    re.I,
)
_RE_INTENT_REBALANCE = re.compile(
    r"\b("
    r"rebalance|re[\s-]?plan\s+(my\s+)?(week|schedule)|"
    r"regenerate\s+(my\s+)?(plan|schedule|calendar)|"
    r"rebuild\s+(my\s+)?(plan|schedule)|"
    r"reschedule\s+my\s+whole\s+(plan|week)"
    r")\b",
    re.I,
)

# "Tuesday", "due tue", etc. → weekday 0=Mon .. 6=Sun (datetime.weekday)
_WEEKDAY_NAMES: Dict[str, int] = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tue": 1,
    "tues": 1,
    "wednesday": 2,
    "wed": 2,
    "thursday": 3,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}


def _detect_planning_intent(text: str) -> Optional[str]:
    """
    Returns 'breakdown_assignment', 'rebalance_plan', or None.
    Breakdown patterns take precedence over rebalance when both could match.
    """
    t = (text or "").strip()
    if not t:
        return None
    if _RE_INTENT_BREAKDOWN.search(t):
        return "breakdown_assignment"
    if _RE_INTENT_REBALANCE.search(t):
        return "rebalance_plan"
    return None


def _weekday_hints_from_message(text: str) -> set[int]:
    low = text.lower()
    found: set[int] = set()
    for name, num in _WEEKDAY_NAMES.items():
        if re.search(rf"\b{re.escape(name)}\b", low):
            found.add(num)
    return found


def _assignment_external_key(row: Dict[str, Any]) -> str:
    ext = row.get("external_id")
    if ext and str(ext).strip():
        return str(ext).strip()
    return f"handall-db-{row.get('id')}"


def _fetch_user_assignment_tasks(local_user_id: int) -> List[Dict[str, Any]]:
    active, _ = _resolve_active_calendar_url(local_user_id)
    if not active:
        return []
    with _open_app_db() as connection:
        rows = connection.execute(
            """
            SELECT *
            FROM tasks
            WHERE user_id = ?
              AND lower(COALESCE(type, '')) = 'assignment'
              AND lower(COALESCE(status, '')) NOT IN ('completed', 'cancelled')
              AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
            ORDER BY start_time ASC
            LIMIT 80
            """,
            (local_user_id, active, active),
        ).fetchall()
    return [dict(r) for r in rows]


def _due_weekday_local(row: Dict[str, Any], tz_name: str) -> int:
    st = _parse_iso_datetime(row["start_time"])
    return st.astimezone(_safe_zone(tz_name)).weekday()


# Strict assignment matching: avoid breaking down the wrong task.
# Weak overlap alone (e.g. "paper", "due") must not unlock a match without strong title similarity.
_MIN_WINNER_SCORE = 0.58  # combined rank score — must clear this for a unique winner
_TIE_SCORE_EPSILON = 0.04  # if multiple candidates within this band of the top → ask user
# Strong single-token match: user token is distinctive (not weak-only) + title similarity floor
_STRONG_SINGLE_SIM_FLOOR = 0.46
_WEAK_MULTI_SIM_FLOOR = 0.60  # ≥2 weak tokens only
_WEAK_SINGLE_SIM_FLOOR = 0.72  # exactly one weak token
_NO_TOKEN_SIM_FLOOR = 0.80  # similarity-only (near-duplicate title in message)

# Generic school/task words — overlap on these alone is not enough (must pair with similarity).
_WEAK_SEMANTIC_TOKENS = frozenset(
    {
        "paper",
        "papers",
        "essay",
        "essays",
        "homework",
        "assignment",
        "assignments",
        "due",
        "deadline",
        "week",
        "class",
        "course",
        "project",
        "projects",
        "report",
        "reports",
        "test",
        "tests",
        "exam",
        "exams",
        "final",
        "midterm",
        "study",
        "studies",
        "work",
        "works",
        "write",
        "read",
        "reading",
        "break",
        "down",
        "plan",
        "plans",
        "schedule",
        "calendar",
        "outline",
        "research",
        "complete",
        "finish",
        "tackle",
        "submit",
        "submission",
        "lab",
        "lecture",
        "quiz",
    }
)


def _assignment_text_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{3,}", (text or "").lower()))


def _strict_assignment_gate(
    user_text: str, row: Dict[str, Any]
) -> Tuple[bool, float, int, str]:
    """
    Pass only with distinctive token overlap and/or high title↔message similarity.
    Uses **title-only** sequence similarity for gates (not description) to avoid
    false passes from boilerplate in long descriptions.
    Returns (passes, sm_title, len(intersection), gate_reason_tag).
    """
    ut = (user_text or "").lower()
    title = (row.get("title") or "").lower()
    desc = ((row.get("description") or "")[:1200]).lower()
    utoks = _assignment_text_tokens(ut)
    ttoks = _assignment_text_tokens(title) | _assignment_text_tokens(desc)
    inter = utoks & ttoks
    strong = inter - _WEAK_SEMANTIC_TOKENS
    sm_title = SequenceMatcher(None, ut, title).ratio()

    if len(strong) >= 2:
        return True, sm_title, len(inter), f"strong_tokens>={len(strong)}"
    if len(strong) >= 1 and sm_title >= _STRONG_SINGLE_SIM_FLOOR:
        return True, sm_title, len(inter), "strong_token+sim"
    if len(strong) == 0 and len(inter) >= 2 and sm_title >= _WEAK_MULTI_SIM_FLOOR:
        return True, sm_title, len(inter), "weak_multi+sim"
    if len(strong) == 0 and len(inter) == 1 and sm_title >= _WEAK_SINGLE_SIM_FLOOR:
        return True, sm_title, len(inter), "weak_single+high_sim"
    if len(inter) == 0 and sm_title >= _NO_TOKEN_SIM_FLOOR:
        return True, sm_title, 0, "title_near_duplicate"

    return False, sm_title, len(inter), "reject_weak_or_low_sim"


def _rank_score_assignment(
    user_text: str,
    row: Dict[str, Any],
    tz_name: str,
    *,
    weekday_pool_filtered: bool,
) -> float:
    """Combined score for ordering candidates that already passed the strict gate."""
    ut = (user_text or "").lower()
    title = (row.get("title") or "").lower()
    desc = ((row.get("description") or "")[:800]).lower()
    sm = SequenceMatcher(None, ut, title).ratio()
    utoks = _assignment_text_tokens(ut)
    ttoks = _assignment_text_tokens(title) | _assignment_text_tokens(desc)
    union = utoks | ttoks
    jacc = len(utoks & ttoks) / len(union) if union else 0.0
    score = 0.62 * sm + 0.38 * jacc
    # Weekday alignment only when we did NOT already restrict the pool to that weekday.
    if not weekday_pool_filtered:
        hints = _weekday_hints_from_message(user_text)
        if hints:
            try:
                if _due_weekday_local(row, tz_name) in hints:
                    score += 0.14
            except Exception:
                pass
    for w in utoks:
        if len(w) > 3 and w in title:
            score += 0.025
    return min(1.0, score)


def _assignment_pool_for_breakdown(
    user_text: str,
    rows: List[Dict[str, Any]],
    tz_name: str,
) -> Tuple[List[Dict[str, Any]], bool]:
    """
    If the user names weekday(s), only consider assignments due on that day in the user's TZ.
    If none exist, fall back to all rows (user may have mistyped the day).
    Returns (pool, weekday_pool_filtered).
    """
    hints = _weekday_hints_from_message(user_text)
    if not hints:
        return rows, False
    matched: List[Dict[str, Any]] = []
    for r in rows:
        try:
            if _due_weekday_local(r, tz_name) in hints:
                matched.append(r)
        except Exception:
            continue
    if matched:
        return matched, True
    return rows, False


class AssignmentBreakdownPick(NamedTuple):
    outcome: Literal["matched", "ambiguous", "none"]
    task: Optional[Dict[str, Any]]
    ambiguous: Tuple[Tuple[Dict[str, Any], float, str], ...]
    reason: str


def _resolve_assignment_for_breakdown(
    user_text: str,
    rows: List[Dict[str, Any]],
    tz_name: str,
) -> AssignmentBreakdownPick:
    """
    Resolve which assignment to break down. Never guess when ambiguous or weak match.
    """
    if not rows:
        return AssignmentBreakdownPick("none", None, (), "no_assignment_rows")

    pool, weekday_pool_filtered = _assignment_pool_for_breakdown(user_text, rows, tz_name)
    pool_reason = (
        f"weekday_restricted_pool size={len(pool)}"
        if weekday_pool_filtered
        else f"full_pool size={len(pool)}"
    )

    wk_hints = sorted(_weekday_hints_from_message(user_text))
    logger.info(
        "agent.assignment_match: trace weekday_hints=%s tz=%s %s user_snip=%r",
        wk_hints,
        tz_name,
        pool_reason,
        (user_text or "")[:280],
    )

    scored: List[Tuple[Dict[str, Any], float, bool, float, int, str]] = []
    for r in pool:
        gate_ok, sm_title, tok_ov, gate_tag = _strict_assignment_gate(user_text, r)
        rs = _rank_score_assignment(
            user_text, r, tz_name, weekday_pool_filtered=weekday_pool_filtered
        )
        scored.append((r, rs, gate_ok, sm_title, tok_ov, gate_tag))

    for r, rs, gok, smt, tok, gtag in sorted(scored, key=lambda x: -x[1]):
        logger.info(
            "agent.assignment_match: cand id=%s gate_pass=%s rank=%.3f title_sim=%.3f "
            "overlap_n=%s gate=%s title=%r",
            r.get("id"),
            gok,
            rs,
            smt,
            tok,
            gtag,
            (r.get("title") or "")[:80],
        )

    eligible = [x for x in scored if x[2]]
    if not eligible:
        best_any = max(scored, key=lambda x: x[1])
        logger.info(
            "agent.assignment_match: outcome=none reason=no_gate_match %s best_id=%s "
            "rank_score=%.3f title_sim=%.3f overlap_n=%s gate_tag=%s",
            pool_reason,
            best_any[0].get("id"),
            best_any[1],
            best_any[3],
            best_any[4],
            best_any[5],
        )
        return AssignmentBreakdownPick(
            "none",
            None,
            (),
            f"no_gate_match; {pool_reason}; best_rank=%.3f" % best_any[1],
        )

    eligible.sort(key=lambda x: x[1], reverse=True)
    top_row, top_score, _, top_seq, top_tok, top_gtag = eligible[0]

    if top_score < _MIN_WINNER_SCORE:
        logger.info(
            "agent.assignment_match: outcome=none reason=below_threshold %s task_id=%s "
            "rank_score=%.3f title_sim=%.3f overlap_n=%s gate=%s",
            pool_reason,
            top_row.get("id"),
            top_score,
            top_seq,
            top_tok,
            top_gtag,
        )
        return AssignmentBreakdownPick(
            "none",
            None,
            (),
            f"below_min_score; {pool_reason}; score=%.3f" % top_score,
        )

    close = [e for e in eligible if e[1] >= top_score - _TIE_SCORE_EPSILON]
    if len(close) >= 2:
        amb: List[Tuple[Dict[str, Any], float, str]] = []
        for r, rs, _, seq, tok, gtag in close[:12]:
            amb.append(
                (
                    r,
                    rs,
                    f"rank={rs:.3f} title_sim={seq:.3f} overlap_n={tok} gate={gtag}",
                )
            )
        logger.info(
            "agent.assignment_match: outcome=ambiguous reason=tied_scores %s "
            "top_rank=%.3f n_in_tie_band=%s task_ids=%s",
            pool_reason,
            top_score,
            len(close),
            [c[0].get("id") for c in close],
        )
        return AssignmentBreakdownPick("ambiguous", None, tuple(amb), f"tied; {pool_reason}")

    win_reason = (
        f"unique_winner; {pool_reason}; rank={top_score:.3f} title_sim={top_seq:.3f} "
        f"overlap_n={top_tok}; gate={top_gtag}"
    )
    logger.info(
        "agent.assignment_match: outcome=matched task_id=%s rank_score=%.3f title_sim=%.3f "
        "overlap_n=%s gate=%s reason=%s",
        top_row.get("id"),
        top_score,
        top_seq,
        top_tok,
        top_gtag,
        win_reason,
    )
    return AssignmentBreakdownPick("matched", top_row, (), win_reason)


def _format_assignment_disambiguation_message(
    candidates: Tuple[Tuple[Dict[str, Any], float, str], ...],
    tz_name: str,
) -> str:
    lines = [
        "### Which assignment?",
        "",
        "More than one assignment matched closely. Reply with the **number** or the **exact title**:",
        "",
    ]
    for i, (row, _score, _why) in enumerate(candidates, 1):
        due = ""
        try:
            st = _parse_iso_datetime(row["start_time"])
            loc = st.astimezone(_safe_zone(tz_name))
            due = f" — due **{loc.strftime('%a %Y-%m-%d %H:%M')}** ({tz_name})"
        except Exception:
            pass
        lines.append(
            f"{i}. **{row.get('title') or 'Untitled'}** (id `{row.get('id')}`){due}"
        )
    lines.append("")
    lines.append("_Example: reply `1` or paste the assignment title._")
    return "\n".join(lines)


def _format_assignment_no_match_message() -> str:
    return (
        "I couldn't find a matching assignment in your current tasks.\n\n"
        "Name the **course or exact title** (or paste it from your schedule), then ask again."
    )


def _replace_assignment_subtasks_sqlite(
    local_user_id: int,
    task_row: Dict[str, Any],
    subtasks: List[Dict[str, Any]],
) -> None:
    key = _assignment_external_key(task_row)
    with _open_app_db() as connection:
        connection.execute(
            """
            DELETE FROM ai_planning_items
            WHERE user_id = ? AND item_type = ? AND assignment_external_id = ?
            """,
            (local_user_id, "assignment_subtask", key),
        )
        for st in subtasks:
            title = str(st.get("title") or "").strip()
            if not title:
                continue
            em = int(st.get("estimated_minutes") or 45)
            em = max(15, min(240, em))
            so = int(st.get("sort_order") or 0)
            desc = str(st.get("description") or "").strip() or None
            connection.execute(
                """
                INSERT INTO ai_planning_items (
                    user_id, item_type, assignment_external_id, assignment_title,
                    side_goal, title, description, estimated_minutes, sort_order, due_iso, rationale
                )
                VALUES (?, 'assignment_subtask', ?, ?, NULL, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    local_user_id,
                    key,
                    task_row.get("title") or "",
                    title,
                    desc,
                    em,
                    so,
                    task_row.get("start_time"),
                ),
            )
        connection.commit()


def _format_breakdown_response(
    task_row: Dict[str, Any],
    subtasks: List[Dict[str, Any]],
    tz_name: str,
) -> str:
    title = task_row.get("title") or "Assignment"
    due_line = ""
    try:
        st = _parse_iso_datetime(task_row["start_time"])
        loc = st.astimezone(_safe_zone(tz_name))
        due_line = f"\n**Due:** {loc.strftime('%A, %Y-%m-%d %H:%M')} ({tz_name})"
    except Exception:
        pass
    lines = [
        "### Assignment breakdown (HandAll)",
        f"**Assignment:** {title}{due_line}",
        "",
        "**Steps (saved to your plan for scheduling):**",
    ]
    ordered = sorted(subtasks, key=lambda x: int(x.get("sort_order") or 0))
    for i, st in enumerate(ordered, 1):
        mn = int(st.get("estimated_minutes") or 45)
        lines.append(f"{i}. **{st.get('title', 'Step')}** — *{mn} min*")
        d = (st.get("description") or "").strip()
        if d:
            lines.append(f"   - {d}")
    lines.append("")
    lines.append(
        "_These subtasks are stored in HandAll. Use **Rebalance** or the planner to place them on your calendar._"
    )
    return "\n".join(lines)


def _last_user_text(state: AgentState) -> str:
    for m in reversed(state.get("messages") or []):
        if isinstance(m, HumanMessage):
            c = m.content
            if isinstance(c, str):
                return c.strip()
            if isinstance(c, list):
                parts: List[str] = []
                for block in c:
                    if isinstance(block, str) and block.strip():
                        parts.append(block.strip())
                    elif isinstance(block, dict) and block.get("type") == "text":
                        t = block.get("text")
                        if isinstance(t, str) and t.strip():
                            parts.append(t.strip())
                return "\n".join(parts).strip()
    return ""


def assignment_intent_handler(state: AgentState) -> Dict[str, Any]:
    """
    Deterministic fast path: breakdown / rebalance without generic LLM chat.
    Always clears or sets bypass_llm so checkpoint state does not skip LLM on later turns.
    """
    text = _last_user_text(state)
    intent = _detect_planning_intent(text)
    if not intent:
        logger.info("agent.fast_path: no breakdown/rebalance intent — using LLM chat")
        return {"bypass_llm": False}

    local_user = _resolve_local_user(state.get("auth_user_id"), state.get("user_metadata"))
    if not local_user:
        logger.warning(
            "agent.fast_path: no local SQLite user for auth_user_id=%s intent=%s",
            state.get("auth_user_id"),
            intent,
        )
        return {
            "messages": [
                AIMessage(
                    content=(
                        "Your account isn’t linked to HandAll tasks yet. "
                        "Open the app while signed in, then try again."
                    )
                )
            ],
            "bypass_llm": True,
        }

    active_cal, _ = _resolve_active_calendar_url(int(local_user["id"]))
    if not active_cal:
        return {
            "messages": [
                AIMessage(
                    content=(
                        "No **active calendar** is set. In **Settings**, import an .ics file or connect "
                        "Google Calendar, then choose which calendar HandAll should use for planning and chat."
                    )
                )
            ],
            "bypass_llm": True,
        }

    motivation = max(0, min(100, int(state.get("motivation") or 50)))
    tz_name = state.get("user_metadata", {}).get("timezone") or "UTC"

    ctx_token = CURRENT_AGENT_CONTEXT.set(
        {
            "user_id": state["user_id"],
            "auth_user_id": state.get("auth_user_id"),
            "motivation": motivation,
            "user_metadata": state.get("user_metadata", {}),
        }
    )
    try:
        if intent == "rebalance_plan":
            logger.info("agent.fast_path: TRIGGER deterministic tool=rebalance_app_plan")
            raw = rebalance_app_plan.invoke({"days": 7})
            if not isinstance(raw, dict):
                raw = {}
            if not raw.get("success"):
                msg = raw.get("message") or "Could not rebalance the plan."
                logger.warning("agent.fast_path: rebalance failed — %s", msg[:200])
                return {"bypass_llm": False}
            summary = (raw.get("message") or "Plan updated.").strip()
            inserted = int(raw.get("inserted_count") or 0)
            deleted = int(raw.get("deleted_count") or 0)
            body = (
                "### Schedule replanned (HandAll)\n\n"
                f"{summary}\n\n"
                f"- Replaced **{deleted}** old blocks with **{inserted}** new planned tasks.\n"
                "_Your calendar tasks in the app are updated._"
            )
            return {
                "messages": [
                    AIMessage(
                        content=body,
                        additional_kwargs={"handall_schedule_updated": True},
                    )
                ],
                "bypass_llm": True,
            }

        # breakdown_assignment
        rows = _fetch_user_assignment_tasks(int(local_user["id"]))
        logger.info(
            "agent.fast_path: assignment_tasks_fetched count=%s local_user_id=%s",
            len(rows),
            local_user["id"],
        )
        if not rows:
            logger.info("agent.fast_path: no assignment-type tasks — deterministic reply")
            return {
                "messages": [
                    AIMessage(
                        content=(
                            "I couldn't find any assignments. Try importing your calendar first."
                        )
                    )
                ],
                "bypass_llm": True,
            }

        pick = _resolve_assignment_for_breakdown(text, rows, tz_name)
        if pick.outcome == "ambiguous":
            logger.info(
                "agent.fast_path: assignment ambiguous — asking user (n=%s)",
                len(pick.ambiguous),
            )
            body = _format_assignment_disambiguation_message(pick.ambiguous, tz_name)
            return {
                "messages": [AIMessage(content=body)],
                "bypass_llm": True,
            }
        if pick.outcome != "matched" or not pick.task:
            logger.info(
                "agent.fast_path: no confident assignment match — skip breakdown (%s)",
                pick.reason,
            )
            return {
                "messages": [AIMessage(content=_format_assignment_no_match_message())],
                "bypass_llm": True,
            }

        matched = pick.task
        logger.info(
            "agent.fast_path: TRIGGER assignment breakdown pipeline task_id=%s key=%s (%s)",
            matched.get("id"),
            _assignment_external_key(matched),
            pick.reason,
        )

        subtasks = generate_assignment_subtasks(
            parent_title=str(matched.get("title") or ""),
            parent_description=str(matched.get("description") or ""),
            due_date_iso=str(matched.get("start_time") or ""),
            motivation=motivation,
        )
        _replace_assignment_subtasks_sqlite(int(local_user["id"]), matched, subtasks)
        body = _format_breakdown_response(matched, subtasks, tz_name)
        return {
            "messages": [AIMessage(content=body)],
            "bypass_llm": True,
        }
    finally:
        CURRENT_AGENT_CONTEXT.reset(ctx_token)


def _route_after_assignment_intent(state: AgentState) -> str:
    if state.get("bypass_llm"):
        return "__end__"
    return "call_model"


@tool
def list_events() -> List[Dict[str, Any]]:
    """Fetch Google Calendar events scheduled in the next 24 hours."""
    ctx = _get_agent_context()
    auth = ctx.get("auth_user_id")
    if auth:
        lu = _resolve_local_user(auth, ctx.get("user_metadata"))
        if lu:
            active, _ = _resolve_active_calendar_url(int(lu["id"]))
            if not active:
                logger.info("agent.calendar: list_events skipped (no active calendar)")
                return []
            if not str(active).startswith("google-oauth:"):
                logger.info(
                    "agent.calendar: list_events skipped — active source is local ICS, not Google (%s)",
                    active,
                )
                return []

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
    ctx = _get_agent_context()
    auth = ctx.get("auth_user_id")
    if auth:
        lu = _resolve_local_user(auth, ctx.get("user_metadata"))
        if lu:
            active, _ = _resolve_active_calendar_url(int(lu["id"]))
            if not active:
                return {"status": "error", "message": "No active calendar — connect Google in Settings first."}
            if not str(active).startswith("google-oauth:"):
                return {
                    "status": "error",
                    "message": "Google Calendar changes are disabled while your active source is a local .ics import.",
                }

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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
            "assignments": [],
        }

    active, _ = _resolve_active_calendar_url(int(local_user["id"]))
    if not active:
        return {
            "success": False,
            "message": "No active calendar source. Import an .ics file or connect Google Calendar in Settings, then sync.",
            "assignments": [],
        }

    safe_days = max(1, min(int(days or 30), 90))
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=safe_days)).isoformat()
    title_filter = f"%{(assignment_title_contains or '').strip().lower()}%"
    src_x = (active, active)

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
                  AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
                ORDER BY start_time ASC
                """,
                (local_user["id"], now_iso, horizon_iso, title_filter) + src_x,
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
                  AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
                ORDER BY start_time ASC
                """,
                (local_user["id"], now_iso, horizon_iso) + src_x,
            ).fetchall()

        allowed_keys = {
            _assignment_external_key(dict(r)) for r in assignment_rows
        }

        planning_rows = connection.execute(
            """
            SELECT *
            FROM ai_planning_items
            WHERE user_id = ?
              AND item_type IN ('assignment_subtask', 'assignment_task')
            ORDER BY assignment_external_id, sort_order ASC, id ASC
            """,
            (local_user["id"],),
        ).fetchall()

    planning_by_assignment: Dict[str, List[Dict[str, Any]]] = {}
    for row in planning_rows:
        assignment_key = row["assignment_external_id"] or ""
        if assignment_key not in allowed_keys:
            continue
        item = {
            "id": str(row["id"]),
            "title": row["title"],
            "description": row["description"] or "",
            "estimated_minutes": int(row["estimated_minutes"] or 0),
            "sort_order": int(row["sort_order"] or 0),
            "due_iso": row["due_iso"],
        }
        existing = planning_by_assignment.setdefault(assignment_key, [])
        signature = (
            item["title"].strip().lower(),
            item["sort_order"],
            item["estimated_minutes"],
        )
        existing_signatures = {
            (
                current["title"].strip().lower(),
                current["sort_order"],
                current["estimated_minutes"],
            )
            for current in existing
        }
        if signature not in existing_signatures:
            existing.append(item)

    assignments: List[Dict[str, Any]] = []
    for row in assignment_rows:
        ser = _serialize_task_row(row)
        ext_key = _assignment_external_key(ser)
        assignments.append(
            {
                "id": ser["id"],
                "external_id": ext_key,
                "title": ser["title"],
                "description": ser["description"] or "",
                "start": ser["start"],
                "end": ser["end"],
                "subtasks": planning_by_assignment.get(ext_key, []),
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
            "message": "Sign in to HandAll in this browser so I can generate assignment subtasks.",
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
        str(row["title"] or ""),
        str(row["description"] or ""),
        due_iso,
        int(context.get("motivation", 50) or 50),
    )
    ser_row = _serialize_task_row(row)
    assignment_external_id = _assignment_external_key(ser_row)

    with _open_app_db() as connection:
        connection.execute(
            """
            DELETE FROM ai_planning_items
            WHERE user_id = ?
              AND item_type IN ('assignment_subtask', 'assignment_task')
              AND assignment_external_id = ?
            """,
            (local_user["id"], assignment_external_id),
        )
        for index, item in enumerate(subtasks, start=1):
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            em = int(item.get("estimated_minutes") or 45)
            em = max(15, min(240, em))
            so = int(item.get("sort_order") or index)
            desc = str(item.get("description") or "").strip() or None
            connection.execute(
                """
                INSERT INTO ai_planning_items (
                    user_id, item_type, assignment_external_id, assignment_title,
                    side_goal, title, description, estimated_minutes, sort_order, due_iso, rationale
                )
                VALUES (?, 'assignment_subtask', ?, ?, NULL, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    local_user["id"],
                    assignment_external_id,
                    ser_row.get("title") or "",
                    title,
                    desc,
                    em,
                    so,
                    due_iso,
                ),
            )
        connection.commit()

    return {
        "success": True,
        "message": f"Generated {len(subtasks)} subtasks for {row['title']}.",
        "assignment": {
            "id": ser_row["id"],
            "external_id": assignment_external_id,
            "title": ser_row["title"],
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
        }

    identifier = (task_identifier or "").strip()
    if not identifier:
        raise ValueError("task_identifier is required")

    active, _ = _resolve_active_calendar_url(int(local_user["id"]))
    if not active:
        return {
            "success": False,
            "message": "No active calendar — set one in Settings before removing tasks.",
        }

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

        if not _task_row_matches_active_calendar(dict(row), active):
            return {
                "success": False,
                "message": "That task is not from your active calendar. Switch the active calendar in Settings to manage it.",
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
            "message": "Sign in to HandAll in this browser so I can read or change your saved tasks.",
        }

    active, _ = _resolve_active_calendar_url(int(local_user["id"]))
    if not active:
        return {
            "success": False,
            "message": "No active calendar source. Import an .ics or connect Google Calendar in Settings first.",
        }

    from backend.planner import generate_weekly_plan

    safe_days = max(3, min(int(days or 7), 14))
    now_iso = datetime.now(timezone.utc).isoformat()
    horizon_iso = (datetime.now(timezone.utc) + timedelta(days=safe_days)).isoformat()
    motivation = max(0, min(int(context.get("motivation") or 50), 100))
    timezone_name = context.get("user_metadata", {}).get("timezone") or "UTC"
    ax = (active, active)

    with _open_app_db() as connection:
        all_rows_raw = connection.execute(
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
        all_rows = [r for r in all_rows_raw if _task_row_matches_active_calendar(dict(r), active)]
        logger.info(
            "agent.calendar: rebalance_app_plan filtered_rows=%s/%s active=%s",
            len(all_rows),
            len(all_rows_raw),
            active,
        )

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
              AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
            ORDER BY start_time ASC
            """,
            (local_user["id"], now_iso, horizon_iso) + ax,
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
              AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
            """,
            (local_user["id"], now_iso, horizon_iso) + ax,
        )

        ak_rows = connection.execute(
            """
            SELECT id, external_id FROM tasks
            WHERE user_id = ? AND lower(COALESCE(type,'')) = 'assignment'
              AND (COALESCE(source_url, '') = ? OR COALESCE(planner_source_url, '') = ?)
            """,
            (local_user["id"],) + ax,
        ).fetchall()
        allowed_assignment_keys = set()
        for ar in ak_rows:
            d = dict(ar)
            allowed_assignment_keys.add(_assignment_external_key(d))

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
                ak = r.get("assignment_external_id") or ""
                if allowed_assignment_keys and ak not in allowed_assignment_keys:
                    continue
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
                INSERT INTO tasks (user_id, external_id, title, description, start_time, end_time, type, planner_source_url, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Accepted')
                """,
                (
                    local_user["id"],
                    task.get("id"),
                    task.get("title"),
                    task.get("description") or None,
                    task.get("start"),
                    task.get("end"),
                    _normalize_task_type(str(task.get("type") or "working")),
                    active,
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
                    SELECT username, side_goals_json, side_goal, motivation, wake_time, sleep_time,
                           active_calendar_source_url, google_calendar_connected, google_calendar_calendar_id, id
                    FROM users
                    WHERE auth_user_id = ?
                    LIMIT 1
                    """,
                    (auth_uid,),
                ).fetchone()
            if row:
                row_d = dict(row)
                try:
                    act_u, act_r = _resolve_active_calendar_url(int(row_d["id"]))
                    user_metadata["active_calendar_source_url"] = act_u or ""
                    user_metadata["active_calendar_resolution"] = act_r
                except Exception:
                    user_metadata["active_calendar_source_url"] = ""
                    user_metadata["active_calendar_resolution"] = "error"
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
    active_cal = user_metadata.get("active_calendar_source_url") or "(none)"
    return (
        f"You are HandAll's execution-focused planning engine for {name}, not a generic tutor or essay coach. "
        f"Timezone: {timezone_name}. Today (local): {today_local}. "
        f"Motivation/energy: {motivation}/100. Side goals: {goals_line}. "
        f"**Active calendar source (only this feed is used for tasks/assignments):** `{active_cal}`. "
        f"If none is set, tell the user to choose a calendar in Settings.\n"
        f"Other prefs: {json.dumps({k: v for k, v in prefs.items() if k not in {'side_goals', 'sideGoals'}})}.\n\n"
        "**Data you already have (do not ask the user to repeat it):**\n"
        f"- Upcoming HandAll tasks from the **active** calendar only (local times, next ~14 days):\n{schedule_snapshot}\n\n"
        "**Rules:**\n"
        "1. Prefer **tools** over prose. Call `list_schedule`, `search_app_tasks`, `list_assignment_plans`, "
        "`generate_assignment_plan`, `rebalance_app_plan`, "
        "`move_app_task_local`, `update_app_task_times`, `add_app_task`, `remove_app_task` to read or change real data.\n"
        "2. Do **not** give textbook study tips, essay structure lectures, or filler questions when the user wants planning "
        "or schedule changes — act on the snapshot and tools.\n"
        "3. If the user asks to break down, plan, or schedule an **assignment**, assume matching rows exist in the snapshot "
        "or DB; use tools to find them (search by title/date) before asking for the assignment title.\n"
        "4. For **replan / rebalance the week**, call `rebalance_app_plan` rather than describing a hypothetical schedule.\n"
        "5. For moves (e.g. “move Sunday 2am to 6am”), infer year from Today, use `local_date_yyyy_mm_dd` and "
        "`move_app_task_local`; only ask for clarification if multiple tasks match.\n"
        "6. Use Google Calendar tools **only** when the user explicitly wants external Google events changed or listed.\n"
        "7. When you change the schedule, state what changed in one short factual paragraph.\n"
        "8. Calendar semantics: fixed rows block time; assignment deadlines anchor work blocks; flexible rows may overlap. "
        "Planner times are deterministic — do not invent times without tools."
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
            "generate_assignment_plan",
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

        elif name == "generate_assignment_plan":
            if payload.get("success"):
                schedule_changed = True
                m = (payload.get("message") or "Assignment plan updated.").strip()
                if m:
                    fact_lines.append(m)
            else:
                any_failure = True
                fact_lines.append(
                    payload.get("message") or "Could not generate assignment plan."
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
    """Extract user-visible text from one structured LangChain content block."""
    typ = block.get("type")
    text_val = block.get("text")
    if not isinstance(text_val, str) or not text_val.strip():
        return ""
    if typ in ("image", "file", "tool_use"):
        return ""
    return text_val.strip()


def _flatten_ai_message_content(content: Any) -> str:
    """LangChain/OpenAI may return str, a single dict, or a list of blocks."""
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
    """Call the OpenAI model with the latest state and let it decide whether to use tools."""
    base = get_openai_chat_model(temperature=0.2)
    if base is None:
        raise RuntimeError("OPENAI_API_KEY is not configured in the environment.")
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
        response = invoke_openai_chat(model, model_input, "agent.call_model")
    finally:
        CURRENT_AGENT_CONTEXT.reset(context_token)
    return {"messages": [response]}


def build_graph():
    graph_builder = StateGraph(AgentState)

    graph_builder.add_node("fetch_user_data", fetch_user_data)
    graph_builder.add_node("assignment_intent_handler", assignment_intent_handler)
    graph_builder.add_node("call_model", call_model)
    graph_builder.add_node("tools", ToolNode(TOOLS))

    graph_builder.add_edge(START, "fetch_user_data")
    graph_builder.add_edge("fetch_user_data", "assignment_intent_handler")
    graph_builder.add_conditional_edges(
        "assignment_intent_handler",
        _route_after_assignment_intent,
        {"call_model": "call_model", "__end__": END},
    )
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

    schedule_from_fast = bool(
        last_ai and last_ai.additional_kwargs.get("handall_schedule_updated")
    )
    final_text, schedule_from_tools = _merge_schedule_tool_truth(result["messages"], final_text)

    return {
        "response": final_text,
        "state": result,
        "schedule_updated": schedule_from_fast or schedule_from_tools,
    }
