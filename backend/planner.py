import json
import math
import os
import re
from collections import defaultdict
from datetime import datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from backend.llm_client import get_gemini_chat_model
from backend.llm_usage import log_llm_chat_completion, log_llm_fallback


def _get_timezone(timezone_name: str):
    try:
        return ZoneInfo(timezone_name or "UTC")
    except Exception:
        return timezone.utc


def _parse_time(value: str, fallback: str) -> time:
    raw_value = value or fallback
    try:
        hours, minutes = raw_value.split(":")
        return time(hour=int(hours), minute=int(minutes))
    except Exception:
        hours, minutes = fallback.split(":")
        return time(hour=int(hours), minute=int(minutes))


def _parse_datetime(value: str, tz: ZoneInfo) -> Optional[datetime]:
    if not value:
        return None

    normalized = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.astimezone(tz)


def _round_down_to_30(minutes: float) -> int:
    return max(0, int(minutes // 30) * 30)


def _extract_json_object(text: str) -> Optional[Any]:
    stripped = text.strip()
    if not stripped:
        return None

    fenced_match = re.search(r"```(?:json)?\s*(.*?)```", stripped, re.DOTALL)
    candidate = fenced_match.group(1).strip() if fenced_match else stripped

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


def _get_planner_model() -> Optional[ChatGoogleGenerativeAI]:
    return get_gemini_chat_model(temperature=0.28)


def _heuristic_assignment_hours(title: str, description: str) -> int:
    combined = f"{title} {description}".lower()

    if re.search(r"(midterm|final|exam)", combined):
        return 4
    if re.search(r"(project|simulator|implementation|hash table|openmp|shell)", combined):
        return 5
    if re.search(r"(lab report|report due)", combined):
        return 3
    if re.search(r"(discussion post|peer repl|resume review)", combined):
        return 1
    if re.search(r"(quiz)", combined):
        return 2
    if re.search(r"(assignment|homework)", combined):
        return 3
    return 2


def _estimate_assignment_hours(assignments: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    model = _get_planner_model()
    fallback = {
        assignment["id"]: {
            "estimated_hours": assignment.get("estimated_hours")
            if isinstance(assignment.get("estimated_hours"), (int, float)) and assignment.get("estimated_hours", 0) > 0
            else _heuristic_assignment_hours(assignment["title"], assignment.get("description", "")),
            "reason": "Estimated from assignment title and description.",
        }
        for assignment in assignments
    }

    if not assignments:
        return fallback
    if not model:
        log_llm_fallback(
            "planner._estimate_assignment_hours",
            "GOOGLE_API_KEY missing or Gemini chat model unavailable",
        )
        return fallback

    prompt_payload = [
        {
            "id": assignment["id"],
            "title": assignment["title"],
            "description": assignment.get("description", ""),
            "due_date": assignment["due_date"].isoformat() if assignment.get("due_date") else None,
            "provided_hours": assignment.get("estimated_hours"),
        }
        for assignment in assignments
    ]

    prompt = (
        "Estimate total focused hours to complete each assignment well (not calendar time — effort only). "
        "Infer assignment type from title/description (paper vs coding vs exam prep vs lab). "
        "Account for vague titles by assuming typical course expectations. "
        "Return only valid JSON: an array of { id, estimated_hours, reason } where reason briefly cites "
        "signals you used. Keep estimated_hours between 1 and 8.\n\n"
        f"{json.dumps(prompt_payload, indent=2)}"
    )

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        log_llm_chat_completion(response, "planner._estimate_assignment_hours")
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, list):
            log_llm_fallback(
                "planner._estimate_assignment_hours",
                "response not a JSON array; using heuristic hours",
            )
            return fallback

        result = dict(fallback)
        for item in parsed:
            if not isinstance(item, dict):
                continue
            assignment_id = item.get("id")
            hours = item.get("estimated_hours")
            if assignment_id in result and isinstance(hours, (int, float)):
                result[assignment_id] = {
                    "estimated_hours": max(1, min(8, int(round(hours)))),
                    "reason": str(item.get("reason") or "Estimated by AI planner."),
                }
        return result
    except Exception as exc:
        log_llm_fallback(
            "planner._estimate_assignment_hours",
            f"exception: {exc!s}"[:300],
        )
        return fallback


def _generate_ai_suggestions(side_goals: List[str], motivation: int) -> Dict[str, List[str]]:
    fallback_goal = []
    for goal in side_goals:
        fallback_goal.extend(
            [
                f"Make progress on {goal}",
                f"Focused practice: {goal}",
                f"Small win session for {goal}",
            ]
        )

    fallback_free = (
        [
            "Take a real break and go for a walk",
            "Listen to music and recharge",
            "Do a low-pressure reset activity",
            "Spend time away from screens for a bit",
        ]
        if motivation <= 40
        else [
            "Take a short walk outside",
            "Read something fun for a while",
            "Call or text someone you like talking to",
            "Do a small reset activity you enjoy",
        ]
    )

    model = _get_planner_model()
    if not model:
        log_llm_fallback(
            "planner._generate_ai_suggestions",
            "GOOGLE_API_KEY missing or Gemini chat model unavailable",
        )
        return {"goal": fallback_goal, "free_time": fallback_free}

    goals_line = json.dumps(side_goals)
    prompt = (
        "You are helping a student plan free time and personal side-goal work. "
        "They may have MULTIPLE side goals; your goal-task suggestions must give fair, practical coverage across ALL of them "
        "(rotate themes so no goal is ignored). Academic deadlines are handled separately — these are personal growth tasks.\n"
        "Return only valid JSON with keys goal and free_time, each an array of short actionable task titles. "
        "goal titles should mention which goal they support when multiple goals exist.\n\n"
        f"motivation={motivation} (0=exhausted, 100=high energy)\n"
        f"side_goals={goals_line}"
    )

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        log_llm_chat_completion(response, "planner._generate_ai_suggestions")
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, dict):
            log_llm_fallback(
                "planner._generate_ai_suggestions",
                "response not a JSON object; using template suggestions",
            )
            return {"goal": fallback_goal, "free_time": fallback_free}

        goal_items = parsed.get("goal")
        free_items = parsed.get("free_time")
        return {
            "goal": goal_items if isinstance(goal_items, list) and goal_items else fallback_goal,
            "free_time": free_items if isinstance(free_items, list) and free_items else fallback_free,
        }
    except Exception as exc:
        log_llm_fallback(
            "planner._generate_ai_suggestions",
            f"exception: {exc!s}"[:300],
        )
        return {"goal": fallback_goal, "free_time": fallback_free}


def _normalize_assignments(
    assignments: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    tz: ZoneInfo,
    plan_start: datetime,
) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    seen_keys = set()

    def add_assignment(raw: Dict[str, Any]) -> None:
        title = str(raw.get("title") or "").strip()
        if not title:
            return

        description = str(raw.get("description") or "").strip()
        due_date = raw.get("due_date")
        if isinstance(due_date, str):
            due_dt = _parse_datetime(due_date, tz)
        elif isinstance(due_date, datetime):
            due_dt = due_date.astimezone(tz)
        else:
            due_dt = None

        if due_dt is None:
            return

        if due_dt < plan_start:
            return

        key = (title.lower(), due_dt.isoformat())
        if key in seen_keys:
            return

        seen_keys.add(key)
        normalized.append(
            {
                "id": str(raw.get("id") or f"assignment-{len(normalized) + 1}"),
                "title": title,
                "description": description,
                "due_date": due_dt,
                "estimated_hours": raw.get("estimated_hours"),
            }
        )

    for assignment in assignments:
        add_assignment(assignment)

    for event in events:
        if event.get("type") != "assignment" or event.get("completed"):
            continue
        add_assignment(
            {
                "id": event.get("id"),
                "title": event.get("title"),
                "description": event.get("description", ""),
                "due_date": event.get("start"),
                "estimated_hours": None,
            }
        )

    normalized.sort(key=lambda item: item["due_date"])
    return normalized


def _build_busy_intervals(
    events: List[Dict[str, Any]],
    tz: ZoneInfo,
    plan_start: datetime,
    plan_end: datetime,
) -> List[Dict[str, datetime]]:
    busy: List[Dict[str, datetime]] = []

    for event in events:
        if event.get("completed"):
            continue
        et = str(event.get("type") or "").lower()
        # Deadlines are due markers, not time blocks. Flexible/optional personal blocks
        # do not reserve time (work may be scheduled there if needed).
        if et == "assignment":
            continue
        if et in ("flexible", "optional_personal", "freetime", "free"):
            continue

        start = _parse_datetime(event.get("start"), tz)
        end = _parse_datetime(event.get("end"), tz)
        if not start or not end:
            continue
        if end <= plan_start or start >= plan_end:
            continue

        busy.append(
            {
                "start": max(start, plan_start),
                "end": min(end, plan_end),
            }
        )

    busy.sort(key=lambda item: item["start"])
    return busy


def _usable_gap_fraction(motivation: int) -> float:
    """Lower motivation → leave more buffer; higher → use more of each gap for planning."""
    if motivation <= 25:
        return 0.32
    if motivation <= 40:
        return 0.38
    if motivation <= 55:
        return 0.45
    if motivation <= 70:
        return 0.52
    if motivation <= 85:
        return 0.58
    return 0.64


def _calculate_usable_slots(
    busy_intervals: List[Dict[str, datetime]],
    tz: ZoneInfo,
    wake_time: str,
    sleep_time: str,
    plan_start: datetime,
    horizon_days: int,
    motivation: int = 50,
) -> List[Dict[str, Any]]:
    wake = _parse_time(wake_time, "07:00")
    sleep = _parse_time(sleep_time, "23:00")
    slots: List[Dict[str, Any]] = []
    frac = _usable_gap_fraction(motivation)

    busy_by_day: Dict[str, List[Dict[str, datetime]]] = defaultdict(list)
    for interval in busy_intervals:
        busy_by_day[interval["start"].date().isoformat()].append(interval)

    for day_offset in range(horizon_days):
        day = (plan_start + timedelta(days=day_offset)).date()
        day_start = datetime.combine(day, wake, tzinfo=tz)
        day_end = datetime.combine(day, sleep, tzinfo=tz)

        if day_offset == 0 and plan_start > day_start:
            day_start = plan_start

        cursor = day_start
        for interval in sorted(busy_by_day.get(day.isoformat(), []), key=lambda item: item["start"]):
            gap_end = min(interval["start"], day_end)
            if gap_end > cursor:
                gap_minutes = (gap_end - cursor).total_seconds() / 60
                usable_minutes = _round_down_to_30(gap_minutes * frac)
                if usable_minutes >= 30:
                    slots.append(
                        {
                            "day_key": day.isoformat(),
                            "start": cursor,
                            "end": cursor + timedelta(minutes=usable_minutes),
                            "remaining_minutes": usable_minutes,
                        }
                    )
            cursor = max(cursor, interval["end"])

        if day_end > cursor:
            gap_minutes = (day_end - cursor).total_seconds() / 60
            usable_minutes = _round_down_to_30(gap_minutes * frac)
            if usable_minutes >= 30:
                slots.append(
                    {
                        "day_key": day.isoformat(),
                        "start": cursor,
                        "end": cursor + timedelta(minutes=usable_minutes),
                        "remaining_minutes": usable_minutes,
                    }
                )

    return slots


def _daily_working_limit(motivation: int) -> int:
    if motivation <= 10:
        return 1
    if motivation <= 40:
        return 2
    if motivation <= 70:
        return 3
    return 4


def _working_block_minutes(motivation: int, remaining_minutes: int, slot_remaining: int) -> int:
    """Chunk size for deadline work: low energy → short bursts; high → longer focus."""
    if motivation <= 35:
        return 30
    if motivation <= 55:
        return 30 if remaining_minutes < 50 or slot_remaining < 50 else 60
    if motivation <= 75:
        return 60 if remaining_minutes >= 60 and slot_remaining >= 60 else 30
    # high motivation — allow longer blocks when the slot supports it
    if slot_remaining >= 90 and remaining_minutes >= 75:
        return 90
    return 60 if remaining_minutes >= 60 and slot_remaining >= 60 else 30


def _goal_block_minutes(motivation: int, remaining_minutes: int, slot_remaining: int) -> int:
    """Chunk personal-goal work; slightly shorter than deadline blocks when tired."""
    cap = min(remaining_minutes, slot_remaining)
    cap = max(15, _round_down_to_30(cap) or 15)
    if motivation <= 35:
        return min(30, cap)
    if motivation <= 55:
        return min(45, cap) if cap >= 45 else 30
    if motivation <= 75:
        return min(60, cap) if cap >= 60 else 30
    return min(60, cap) if cap >= 60 else 30


def _normalize_assignment_work_units(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        aid = str(item.get("assignment_id") or item.get("assignment_external_id") or "assignment")
        em = item.get("estimated_minutes")
        if not isinstance(em, (int, float)):
            em = 45
        out.append(
            {
                "id": str(item.get("id") or f"u-{len(out)}"),
                "assignment_id": aid,
                "assignment_title": str(item.get("assignment_title") or "").strip(),
                "title": title,
                "description": str(item.get("description") or "").strip(),
                "estimated_minutes": max(15, min(240, int(round(em)))),
                "sort_order": int(item.get("sort_order") or 0),
                "due_iso": item.get("due_iso") or item.get("due_date"),
            }
        )
    return out


def _normalize_goal_work_units(raw: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        em = item.get("estimated_minutes")
        if not isinstance(em, (int, float)):
            em = 35
        out.append(
            {
                "id": str(item.get("id") or f"g-{len(out)}"),
                "title": title,
                "description": str(item.get("description") or "").strip(),
                "estimated_minutes": max(15, min(120, int(round(em)))),
                "side_goal": str(item.get("side_goal") or "").strip(),
                "sort_order": int(item.get("sort_order") or 0),
            }
        )
    return out


def _assignment_meta_from_work_units(work_units: List[Dict[str, Any]], tz: ZoneInfo) -> List[Dict[str, Any]]:
    by_id: Dict[str, Dict[str, Any]] = {}
    for u in work_units:
        aid = u["assignment_id"]
        due_raw = u.get("due_iso")
        due_dt = _parse_datetime(str(due_raw), tz) if due_raw else None
        if aid not in by_id:
            by_id[aid] = {
                "id": aid,
                "title": u.get("assignment_title") or u["title"],
                "description": "",
                "_due_dt": due_dt,
                "estimated_hours": 0.0,
                "estimate_reason": "Sum of AI subtasks.",
            }
        else:
            prev = by_id[aid].get("_due_dt")
            if due_dt and (prev is None or due_dt < prev):
                by_id[aid]["_due_dt"] = due_dt
        hours = u["estimated_minutes"] / 60.0
        by_id[aid]["estimated_hours"] = float(by_id[aid]["estimated_hours"]) + hours
    out: List[Dict[str, Any]] = []
    for row in by_id.values():
        ddt = row.pop("_due_dt", None)
        row["due_date"] = ddt.isoformat() if ddt else ""
        out.append(row)
    return sorted(out, key=lambda x: x.get("due_date") or "")


def _make_task(
    *,
    task_id: str,
    title: str,
    description: str,
    start: datetime,
    duration_minutes: int,
    task_type: str,
) -> Dict[str, Any]:
    end = start + timedelta(minutes=duration_minutes)
    xp_value = {"working": 50, "goal": 30, "freetime": 10}.get(task_type, 10)
    return {
        "id": task_id,
        "title": title,
        "description": description,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "type": task_type,
        "xpValue": xp_value,
    }


def generate_weekly_plan(payload: Dict[str, Any]) -> Dict[str, Any]:
    timezone_name = payload.get("timezone") or "UTC"
    tz = _get_timezone(timezone_name)
    now = datetime.now(tz)
    plan_start = now.replace(second=0, microsecond=0)
    horizon_days = max(3, min(int(payload.get("horizon_days") or 7), 14))
    plan_end = plan_start + timedelta(days=horizon_days)
    motivation = max(0, min(int(payload.get("motivation") or 50), 100))

    events = payload.get("events") or []
    side_goals = [goal for goal in (payload.get("side_goals") or []) if isinstance(goal, str) and goal.strip()]
    assignment_work_units = _normalize_assignment_work_units(payload.get("assignment_work_units"))
    goal_work_units = _normalize_goal_work_units(payload.get("goal_work_units"))

    assignments = _normalize_assignments(payload.get("assignments") or [], events, tz, plan_start)

    estimates = _estimate_assignment_hours(assignments)
    enriched_assignments = []
    for assignment in assignments:
        estimate = estimates.get(assignment["id"], {"estimated_hours": 2, "reason": "Estimated from title."})
        enriched_assignments.append(
            {
                **assignment,
                "estimated_hours": estimate["estimated_hours"],
                "estimate_reason": estimate["reason"],
            }
        )

    busy_intervals = _build_busy_intervals(events, tz, plan_start, plan_end)
    usable_slots = _calculate_usable_slots(
        busy_intervals,
        tz,
        payload.get("wake_time") or "07:00",
        payload.get("sleep_time") or "23:00",
        plan_start,
        horizon_days,
        motivation,
    )

    suggestions: List[Dict[str, Any]] = []
    working_by_day: Dict[str, int] = defaultdict(int)
    daily_limit = _daily_working_limit(motivation)

    far_future = plan_end + timedelta(days=365)

    def _unit_due_dt(unit: Dict[str, Any]) -> datetime:
        raw = unit.get("due_iso")
        if not raw:
            return far_future
        parsed = _parse_datetime(str(raw), tz)
        return parsed if parsed else far_future

    slot_index = 0

    if assignment_work_units:
        sorted_units = sorted(
            assignment_work_units,
            key=lambda u: (_unit_due_dt(u), u["assignment_id"], u["sort_order"], u["id"]),
        )
        for unit in sorted_units:
            due_dt = _unit_due_dt(unit)
            if due_dt < plan_start:
                continue
            remaining_minutes = int(unit["estimated_minutes"])
            block_index = 1
            assignment_id = unit["assignment_id"]
            unit_id = unit["id"]
            title_base = unit["title"]
            unit_desc = unit["description"] or f"Subtask for {unit.get('assignment_title') or 'assignment'}."

            while remaining_minutes > 0 and slot_index < len(usable_slots):
                slot = usable_slots[slot_index]
                if slot["start"] >= due_dt:
                    break

                if working_by_day[slot["day_key"]] >= daily_limit:
                    slot_index += 1
                    continue

                duration = _working_block_minutes(
                    motivation, remaining_minutes, slot["remaining_minutes"]
                )
                if slot["remaining_minutes"] < duration:
                    slot_index += 1
                    continue

                task_title = title_base
                if remaining_minutes > duration:
                    task_title = f"{title_base} (part {block_index})"

                suggestions.append(
                    _make_task(
                        task_id=f"{assignment_id}-sub-{unit_id}-w{block_index}",
                        title=task_title,
                        description=unit_desc,
                        start=slot["start"],
                        duration_minutes=duration,
                        task_type="working",
                    )
                )

                slot["start"] = slot["start"] + timedelta(minutes=duration)
                slot["remaining_minutes"] -= duration
                remaining_minutes -= duration
                working_by_day[slot["day_key"]] += 1
                block_index += 1

                if slot["remaining_minutes"] < 30:
                    slot_index += 1

        assignment_return = _assignment_meta_from_work_units(assignment_work_units, tz)
    else:
        for assignment in enriched_assignments:
            remaining_minutes = int(math.ceil(float(assignment["estimated_hours"]) * 60))
            block_index = 1
            while remaining_minutes > 0 and slot_index < len(usable_slots):
                slot = usable_slots[slot_index]
                if slot["start"] >= assignment["due_date"]:
                    break

                if working_by_day[slot["day_key"]] >= daily_limit:
                    slot_index += 1
                    continue

                duration = _working_block_minutes(
                    motivation, remaining_minutes, slot["remaining_minutes"]
                )
                if slot["remaining_minutes"] < duration:
                    slot_index += 1
                    continue

                task_title = assignment["title"]
                if remaining_minutes > duration:
                    task_title = f"{assignment['title']} - Focus Block {block_index}"

                suggestions.append(
                    _make_task(
                        task_id=f"{assignment['id']}-working-{block_index}",
                        title=task_title,
                        description=assignment.get("description")
                        or f"Make progress on {assignment['title']}.",
                        start=slot["start"],
                        duration_minutes=duration,
                        task_type="working",
                    )
                )

                slot["start"] = slot["start"] + timedelta(minutes=duration)
                slot["remaining_minutes"] -= duration
                remaining_minutes -= duration
                working_by_day[slot["day_key"]] += 1
                block_index += 1

                if slot["remaining_minutes"] < 30:
                    slot_index += 1

        assignment_return = [
            {
                "id": assignment["id"],
                "title": assignment["title"],
                "description": assignment.get("description", ""),
                "due_date": assignment["due_date"].isoformat(),
                "estimated_hours": assignment["estimated_hours"],
                "estimate_reason": assignment["estimate_reason"],
            }
            for assignment in enriched_assignments
        ]

    ideas = _generate_ai_suggestions(side_goals, motivation)
    goal_ideas = ideas["goal"] or [f"Make progress on {goal}" for goal in side_goals]
    free_ideas = ideas["free_time"] or ["Take a real break and recharge"]

    remaining_slots = [slot for slot in usable_slots if slot["remaining_minutes"] >= 30]
    extra_bias = "goal" if motivation > 70 else "free" if motivation <= 40 else "balanced"

    extra_counter = 0

    if goal_work_units:
        sorted_goals = sorted(
            goal_work_units,
            key=lambda g: (g.get("side_goal") or "", g["sort_order"], g["id"]),
        )
        g_idx = 0
        for unit in sorted_goals:
            rem = int(unit["estimated_minutes"])
            title = unit["title"]
            desc = unit["description"] or "Personal goal progress (planner-scheduled)."
            sg = unit.get("side_goal") or ""
            if sg and sg.lower() not in title.lower():
                disp_title = f"{sg}: {title}"
            else:
                disp_title = title
            block_num = 1
            while rem > 0:
                slot = next((s for s in usable_slots if s["remaining_minutes"] >= 15), None)
                if slot is None:
                    break
                duration = _goal_block_minutes(motivation, rem, slot["remaining_minutes"])
                if duration < 15:
                    break
                suggestions.append(
                    _make_task(
                        task_id=f"goal-{unit['id']}-b{block_num}",
                        title=disp_title if block_num == 1 else f"{disp_title} (part {block_num})",
                        description=desc,
                        start=slot["start"],
                        duration_minutes=duration,
                        task_type="goal",
                    )
                )
                slot["start"] = slot["start"] + timedelta(minutes=duration)
                slot["remaining_minutes"] -= duration
                rem -= duration
                block_num += 1
            g_idx += 1

        remaining_slots = [slot for slot in usable_slots if slot["remaining_minutes"] >= 30]
        free_index = 0
        for slot in remaining_slots:
            if slot["remaining_minutes"] < 30:
                continue
            duration = 30 if motivation <= 40 else (60 if slot["remaining_minutes"] >= 60 else 30)
            duration = min(duration, slot["remaining_minutes"])
            duration = max(15, _round_down_to_30(duration) or 15)
            suggestions.append(
                _make_task(
                    task_id=f"extra-freetime-{extra_counter + 1}",
                    title=free_ideas[free_index % len(free_ideas)],
                    description="Free time suggestion to protect rest and keep your schedule sustainable.",
                    start=slot["start"],
                    duration_minutes=duration,
                    task_type="freetime",
                )
            )
            slot["start"] = slot["start"] + timedelta(minutes=duration)
            slot["remaining_minutes"] -= duration
            free_index += 1
            extra_counter += 1
    else:
        goal_index = 0
        free_index = 0
        num_goals = len(side_goals)
        for slot in remaining_slots:
            if slot["remaining_minutes"] < 30:
                continue

            if motivation <= 40:
                duration = 30
            elif motivation >= 80 and slot["remaining_minutes"] >= 60:
                duration = 60
            else:
                duration = 60 if slot["remaining_minutes"] >= 60 else 30

            choose_goal = (
                num_goals > 0
                and (
                    extra_bias == "goal"
                    or (extra_bias == "balanced" and extra_counter % 2 == 0)
                )
            )

            if choose_goal and goal_ideas:
                idea = goal_ideas[goal_index % len(goal_ideas)]
                task_type = "goal"
                active_goal = side_goals[extra_counter % num_goals] if num_goals else ""
                if active_goal and active_goal.lower() not in idea.lower():
                    title = f"{active_goal}: {idea}"
                else:
                    title = idea
                description = (
                    f"Side-goal block aligned to motivation {motivation}/100. "
                    f"Covers your goals: {', '.join(side_goals)}."
                )
                goal_index += 1
            else:
                title = free_ideas[free_index % len(free_ideas)]
                task_type = "freetime"
                description = "Free time suggestion to protect rest and keep your schedule sustainable."
                free_index += 1

            suggestions.append(
                _make_task(
                    task_id=f"extra-{task_type}-{extra_counter + 1}",
                    title=title,
                    description=description,
                    start=slot["start"],
                    duration_minutes=duration,
                    task_type=task_type,
                )
            )

            slot["start"] = slot["start"] + timedelta(minutes=duration)
            slot["remaining_minutes"] -= duration
            extra_counter += 1

    suggestions.sort(key=lambda item: item["start"])

    return {
        "assignments": assignment_return,
        "suggested_tasks": suggestions,
        "meta": {
            "motivation": motivation,
            "timezone": timezone_name,
            "planning_window_days": horizon_days,
            "free_slots_considered": len(usable_slots),
            "side_goals": side_goals,
            "daily_working_block_cap": _daily_working_limit(motivation),
            "used_ai_assignment_subtasks": bool(assignment_work_units),
            "used_ai_goal_tasks": bool(goal_work_units),
        },
    }
