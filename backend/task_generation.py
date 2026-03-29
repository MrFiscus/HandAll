"""
AI generates schedulable task *definitions* only (titles, effort, order).
The planner (`planner.py`) assigns calendar times — not the LLM.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage
from langchain_google_genai import ChatGoogleGenerativeAI

from backend.llm_client import get_gemini_chat_model
from backend.llm_usage import log_llm_chat_completion, log_llm_fallback


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
    return get_gemini_chat_model(temperature=0.2)


def _fallback_assignment_subtasks(parent_title: str, motivation: int) -> List[Dict[str, Any]]:
    """Small, motivation-aware steps when no API key or parse fails."""
    if motivation <= 35:
        return [
            {
                "title": f"{parent_title}: gather materials",
                "description": "Collect notes, rubric, and any required readings.",
                "estimated_minutes": 25,
                "sort_order": 1,
            },
            {
                "title": f"{parent_title}: first draft slice",
                "description": "Do one small deliverable or section only.",
                "estimated_minutes": 35,
                "sort_order": 2,
            },
            {
                "title": f"{parent_title}: quick review",
                "description": "Skim for gaps; fix only the worst issues.",
                "estimated_minutes": 25,
                "sort_order": 3,
            },
        ]
    if motivation >= 75:
        return [
            {
                "title": f"{parent_title}: research & notes",
                "description": "Deep read sources; capture citations.",
                "estimated_minutes": 90,
                "sort_order": 1,
            },
            {
                "title": f"{parent_title}: outline & structure",
                "description": "Lock sections, thesis, and evidence map.",
                "estimated_minutes": 45,
                "sort_order": 2,
            },
            {
                "title": f"{parent_title}: full draft",
                "description": "Write the main body end-to-end.",
                "estimated_minutes": 120,
                "sort_order": 3,
            },
            {
                "title": f"{parent_title}: revise & polish",
                "description": "Edit flow, clarity, and requirements check.",
                "estimated_minutes": 60,
                "sort_order": 4,
            },
        ]
    return [
        {
            "title": f"{parent_title}: research & outline",
            "description": "Skim sources and sketch structure.",
            "estimated_minutes": 45,
            "sort_order": 1,
        },
        {
            "title": f"{parent_title}: main work session",
            "description": "Primary writing, problem-solving, or implementation block.",
            "estimated_minutes": 60,
            "sort_order": 2,
        },
        {
            "title": f"{parent_title}: review & tighten",
            "description": "Edit, verify requirements, submit prep.",
            "estimated_minutes": 45,
            "sort_order": 3,
        },
    ]


def _fallback_goal_tasks(side_goals: List[str], motivation: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    order = 0
    for goal in side_goals:
        g = goal.strip()
        if not g:
            continue
        order += 1
        if motivation <= 35:
            out.append(
                {
                    "title": f"{g}: 15-minute micro-step",
                    "description": f"One tiny, low-pressure step toward: {g}",
                    "estimated_minutes": 20,
                    "side_goal": g,
                    "sort_order": order,
                }
            )
            out.append(
                {
                    "title": f"{g}: light review",
                    "description": "Skim notes or one short resource.",
                    "estimated_minutes": 25,
                    "side_goal": g,
                    "sort_order": order + 10,
                }
            )
        elif motivation >= 75:
            out.append(
                {
                    "title": f"{g}: focused practice block",
                    "description": f"Substantive practice or build session for {g}.",
                    "estimated_minutes": 55,
                    "side_goal": g,
                    "sort_order": order,
                }
            )
            out.append(
                {
                    "title": f"{g}: stretch challenge",
                    "description": "Tackle a harder sub-problem or portfolio piece.",
                    "estimated_minutes": 50,
                    "side_goal": g,
                    "sort_order": order + 10,
                }
            )
        else:
            out.append(
                {
                    "title": f"{g}: one concrete task",
                    "description": f"Specific actionable step for {g} (e.g. one exercise, one bullet improved).",
                    "estimated_minutes": 35,
                    "side_goal": g,
                    "sort_order": order,
                }
            )
            out.append(
                {
                    "title": f"{g}: follow-up",
                    "description": "Short session to consolidate what you did last time.",
                    "estimated_minutes": 30,
                    "side_goal": g,
                    "sort_order": order + 10,
                }
            )
    return out


def generate_assignment_subtasks(
    parent_title: str,
    parent_description: str,
    due_date_iso: Optional[str],
    motivation: int,
) -> List[Dict[str, Any]]:
    """
    Returns subtasks with: title, description, estimated_minutes, sort_order.
    No calendar times.
    """
    motivation = max(0, min(100, int(motivation)))
    model = _get_planner_model()
    base = _fallback_assignment_subtasks(parent_title, motivation)

    if not model:
        log_llm_fallback(
            "task_generation.generate_assignment_subtasks",
            "GOOGLE_API_KEY missing or Gemini chat model unavailable",
        )
        return base

    prompt = (
        "You break a student's assignment into ordered, actionable subtasks. "
        "Do NOT suggest dates, times, or calendar slots — only task definitions.\n"
        f"Motivation level: {motivation}/100. Low motivation → fewer, smaller, easier steps; "
        "high motivation → can include deeper or longer steps.\n"
        "Return ONLY valid JSON: an array of objects with keys "
        "title (string), description (string), estimated_minutes (integer 15-120), sort_order (integer starting at 1).\n\n"
        f"Assignment title: {parent_title}\n"
        f"Description: {parent_description or '(none)'}\n"
        f"Due (context only, do not schedule): {due_date_iso or 'unknown'}\n"
    )

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        log_llm_chat_completion(response, "task_generation.generate_assignment_subtasks")
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, list) or not parsed:
            log_llm_fallback(
                "task_generation.generate_assignment_subtasks",
                "parse failed or empty list; using heuristic subtasks",
            )
            return base

        cleaned: List[Dict[str, Any]] = []
        for i, item in enumerate(parsed):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            desc = str(item.get("description") or "").strip()
            minutes = item.get("estimated_minutes")
            if not isinstance(minutes, (int, float)):
                minutes = 45
            minutes = max(15, min(120, int(round(minutes))))
            sort_order = item.get("sort_order")
            if not isinstance(sort_order, (int, float)):
                sort_order = i + 1
            cleaned.append(
                {
                    "title": title,
                    "description": desc,
                    "estimated_minutes": minutes,
                    "sort_order": int(sort_order),
                }
            )
        return cleaned if cleaned else base
    except Exception as exc:
        log_llm_fallback(
            "task_generation.generate_assignment_subtasks",
            f"exception: {exc!s}"[:300],
        )
        return base


def generate_assignments_subtasks_batch(
    items: List[Dict[str, Any]],
    motivation: int,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    One LLM call per chunk (caller chunks). Returns assignment_key -> subtasks list.
    Every key gets a list (fallback if parse/model fails).
    """
    motivation = max(0, min(100, int(motivation)))
    normalized: List[Dict[str, str]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        k = str(it.get("assignment_key") or "").strip()
        title = str(it.get("title") or "").strip()
        if not k or not title:
            continue
        normalized.append(
            {
                "assignment_key": k,
                "title": title,
                "description": str(it.get("description") or "").strip(),
                "due_date_iso": str(it.get("due_date_iso") or "").strip() or "",
            }
        )

    if not normalized:
        return {}

    fallback_map: Dict[str, List[Dict[str, Any]]] = {
        row["assignment_key"]: _fallback_assignment_subtasks(row["title"], motivation) for row in normalized
    }

    model = _get_planner_model()
    if not model:
        log_llm_fallback(
            "task_generation.generate_assignments_subtasks_batch",
            "GOOGLE_API_KEY missing or Gemini chat model unavailable",
        )
        return fallback_map

    payload = [
        {
            "assignment_key": row["assignment_key"],
            "title": row["title"],
            "description": row["description"] or None,
            "due_date_iso": row["due_date_iso"] or None,
        }
        for row in normalized
    ]
    keys_json = json.dumps([row["assignment_key"] for row in normalized])
    prompt = (
        "You break MULTIPLE student assignments into ordered, actionable subtasks each. "
        "Do NOT suggest dates, times, or calendar slots — only task definitions.\n"
        f"Motivation level: {motivation}/100. Low → fewer, smaller, easier steps per assignment; "
        "high → can include deeper steps.\n"
        "Return ONLY valid JSON with a single key \"results\" whose value is an array. "
        "Each element must have \"assignment_key\" (string, must match input exactly) and "
        "\"subtasks\" (array of objects with title, description, estimated_minutes 15-120, sort_order).\n"
        "You MUST include exactly one entry per assignment_key listed below — no duplicates, no omissions.\n\n"
        f"Required assignment_keys: {keys_json}\n\n"
        f"assignments={json.dumps(payload, indent=2)}"
    )

    def _clean_subtask_list(raw: Any, fallback: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(raw, list) or not raw:
            return fallback
        cleaned: List[Dict[str, Any]] = []
        for i, item in enumerate(raw):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            desc = str(item.get("description") or "").strip()
            minutes = item.get("estimated_minutes")
            if not isinstance(minutes, (int, float)):
                minutes = 45
            minutes = max(15, min(120, int(round(minutes))))
            sort_order = item.get("sort_order")
            if not isinstance(sort_order, (int, float)):
                sort_order = i + 1
            cleaned.append(
                {
                    "title": title,
                    "description": desc,
                    "estimated_minutes": minutes,
                    "sort_order": int(sort_order),
                }
            )
        return cleaned if cleaned else fallback

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        log_llm_chat_completion(response, "task_generation.generate_assignments_subtasks_batch")
        parsed = _extract_json_object(str(response.content))
        out: Dict[str, List[Dict[str, Any]]] = dict(fallback_map)
        if isinstance(parsed, dict):
            results = parsed.get("results")
            if isinstance(results, list):
                for entry in results:
                    if not isinstance(entry, dict):
                        continue
                    ak = str(entry.get("assignment_key") or "").strip()
                    if ak not in out:
                        continue
                    out[ak] = _clean_subtask_list(entry.get("subtasks"), fallback_map[ak])
        return out
    except Exception as exc:
        log_llm_fallback(
            "task_generation.generate_assignments_subtasks_batch",
            f"exception: {exc!s}"[:300],
        )
        return fallback_map


def generate_goal_tasks(side_goals: List[str], motivation: int) -> List[Dict[str, Any]]:
    """
    Returns tasks with: title, description, estimated_minutes, side_goal, sort_order.
    No calendar times.
    """
    goals = [g.strip() for g in side_goals if isinstance(g, str) and g.strip()]
    motivation = max(0, min(100, int(motivation)))
    base = _fallback_goal_tasks(goals, motivation)
    if not goals:
        return []

    model = _get_planner_model()
    if not model:
        log_llm_fallback(
            "task_generation.generate_goal_tasks",
            "GOOGLE_API_KEY missing or Gemini chat model unavailable",
        )
        return base

    goals_json = json.dumps(goals)
    prompt = (
        "The user has personal growth goals (not school assignments). "
        "Generate specific, actionable tasks — not vague advice.\n"
        "Do NOT include dates, times, or calendar placement.\n"
        f"Motivation: {motivation}/100. Low → shorter, gentler tasks; high → more demanding is OK.\n"
        "Cover ALL goals fairly (rotate across goals).\n"
        "Return ONLY valid JSON: an array of objects with keys "
        "title, description, estimated_minutes (20-90), side_goal (must match one of the user's goals), sort_order.\n\n"
        f"goals={goals_json}"
    )

    try:
        response = model.invoke([HumanMessage(content=prompt)])
        log_llm_chat_completion(response, "task_generation.generate_goal_tasks")
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, list) or not parsed:
            log_llm_fallback(
                "task_generation.generate_goal_tasks",
                "parse failed or empty list; using heuristic goal tasks",
            )
            return base

        goal_set = {g.lower() for g in goals}
        cleaned: List[Dict[str, Any]] = []
        for i, item in enumerate(parsed):
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            sg = str(item.get("side_goal") or "").strip()
            if not sg or sg.lower() not in goal_set:
                # attach to nearest goal by round-robin
                sg = goals[i % len(goals)]
            desc = str(item.get("description") or "").strip()
            minutes = item.get("estimated_minutes")
            if not isinstance(minutes, (int, float)):
                minutes = 35
            minutes = max(20, min(90, int(round(minutes))))
            sort_order = item.get("sort_order")
            if not isinstance(sort_order, (int, float)):
                sort_order = i + 1
            cleaned.append(
                {
                    "title": title,
                    "description": desc,
                    "estimated_minutes": minutes,
                    "side_goal": sg,
                    "sort_order": int(sort_order),
                }
            )
        return cleaned if cleaned else base
    except Exception as exc:
        log_llm_fallback(
            "task_generation.generate_goal_tasks",
            f"exception: {exc!s}"[:300],
        )
        return base
