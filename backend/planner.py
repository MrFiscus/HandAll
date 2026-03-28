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
    google_api_key = os.getenv("GOOGLE_API_KEY")
    if not google_api_key:
        return None

    return ChatGoogleGenerativeAI(
        model=os.getenv("GOOGLE_MODEL", "gemini-2.5-flash"),
        google_api_key=google_api_key,
        temperature=0.2,
    )


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

    if not model or not assignments:
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
        "Estimate how many hours a student should spend to complete each assignment. "
        "Return only valid JSON as an array of objects with keys id, estimated_hours, and reason. "
        "Keep estimated_hours between 1 and 8.\n\n"
        f"{json.dumps(prompt_payload, indent=2)}"
    )

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, list):
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
    except Exception:
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
        return {"goal": fallback_goal, "free_time": fallback_free}

    prompt = (
        "You are helping a student plan free time and goal tasks. "
        "Return only valid JSON with keys goal and free_time, each containing a short array of task titles. "
        "Make goal suggestions practical and specific. Make free_time suggestions restorative and light.\n\n"
        f"motivation={motivation}\n"
        f"side_goals={json.dumps(side_goals)}"
    )

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, dict):
            return {"goal": fallback_goal, "free_time": fallback_free}

        goal_items = parsed.get("goal")
        free_items = parsed.get("free_time")
        return {
            "goal": goal_items if isinstance(goal_items, list) and goal_items else fallback_goal,
            "free_time": free_items if isinstance(free_items, list) and free_items else fallback_free,
        }
    except Exception:
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
        if event.get("type") == "assignment":
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


def _calculate_usable_slots(
    busy_intervals: List[Dict[str, datetime]],
    tz: ZoneInfo,
    wake_time: str,
    sleep_time: str,
    plan_start: datetime,
    horizon_days: int,
) -> List[Dict[str, Any]]:
    wake = _parse_time(wake_time, "07:00")
    sleep = _parse_time(sleep_time, "23:00")
    slots: List[Dict[str, Any]] = []

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
                usable_minutes = _round_down_to_30(gap_minutes * 0.5)
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
            usable_minutes = _round_down_to_30(gap_minutes * 0.5)
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
    )

    suggestions: List[Dict[str, Any]] = []
    working_by_day: Dict[str, int] = defaultdict(int)
    daily_limit = _daily_working_limit(motivation)

    slot_index = 0
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

            duration = 60 if remaining_minutes >= 60 else 30
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
                    description=assignment.get("description") or f"Make progress on {assignment['title']}.",
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

    ideas = _generate_ai_suggestions(side_goals, motivation)
    goal_ideas = ideas["goal"] or [f"Make progress on {goal}" for goal in side_goals]
    free_ideas = ideas["free_time"] or ["Take a real break and recharge"]

    remaining_slots = [slot for slot in usable_slots if slot["remaining_minutes"] >= 30]
    extra_bias = "goal" if motivation > 70 else "free" if motivation <= 40 else "balanced"

    goal_index = 0
    free_index = 0
    extra_counter = 0
    for slot in remaining_slots:
        if slot["remaining_minutes"] < 30:
            continue

        duration = 60 if slot["remaining_minutes"] >= 60 else 30
        choose_goal = (
            side_goals
            and (
                extra_bias == "goal"
                or (extra_bias == "balanced" and extra_counter % 2 == 0)
            )
        )

        if choose_goal and goal_ideas:
            idea = goal_ideas[goal_index % len(goal_ideas)]
            task_type = "goal"
            description = "Goal task suggested from your current motivation and side goals."
            goal_index += 1
        else:
            idea = free_ideas[free_index % len(free_ideas)]
            task_type = "freetime"
            description = "Free time suggestion to protect rest and keep your schedule sustainable."
            free_index += 1

        suggestions.append(
            _make_task(
                task_id=f"extra-{task_type}-{extra_counter + 1}",
                title=idea,
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
        "assignments": [
            {
                "id": assignment["id"],
                "title": assignment["title"],
                "description": assignment.get("description", ""),
                "due_date": assignment["due_date"].isoformat(),
                "estimated_hours": assignment["estimated_hours"],
                "estimate_reason": assignment["estimate_reason"],
            }
            for assignment in enriched_assignments
        ],
        "suggested_tasks": suggestions,
        "meta": {
            "motivation": motivation,
            "timezone": timezone_name,
            "planning_window_days": horizon_days,
            "free_slots_considered": len(usable_slots),
        },
    }
