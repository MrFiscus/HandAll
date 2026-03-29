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
from langchain_openai import ChatOpenAI

from backend.llm_client import get_openai_chat_model
from backend.llm_usage import invoke_openai_chat, log_llm_fallback


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


def _get_planner_model() -> Optional[ChatOpenAI]:
    # Slightly higher temperature for richer decomposition while keeping JSON parseable.
    return get_openai_chat_model(temperature=0.32)


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
            "OPENAI_API_KEY missing or OpenAI chat model unavailable",
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
        response = invoke_openai_chat(model, [HumanMessage(content=prompt)], "task_generation.generate_assignment_subtasks")
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
            "OPENAI_API_KEY missing or OpenAI chat model unavailable",
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
        "You are an expert academic coach. For EACH assignment, infer the assignment kind "
        "(e.g. research paper, coding project, exam prep, lab report, presentation) from the title/description, "
        "then break it into ordered work units (subtasks) that a student can schedule.\n"
        "Rules:\n"
        "- Do NOT assign calendar times or dates — titles, descriptions, durations, and order only.\n"
        "- Work units must be concrete (e.g. 'Outline section 2', 'Run test suite on module A').\n"
        "- estimated_minutes: 15–180 per unit; sum should roughly match realistic total effort.\n"
        "- For vague titles, infer likely steps (research → outline → draft → revise for papers).\n"
        "- Include a short \"rationale\" on each subtask: one sentence on why this step matters.\n"
        f"Motivation {motivation}/100: low energy → fewer, shorter steps; high → more depth.\n"
        "Return ONLY valid JSON: { \"results\": [ { \"assignment_key\", \"assignment_kind\", \"breakdown_summary\", "
        "\"subtasks\": [ { \"title\", \"description\", \"estimated_minutes\", \"sort_order\", \"rationale\" } ] } ] }\n"
        "You MUST include exactly one results[] entry per assignment_key below — no duplicates, no omissions.\n\n"
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
            minutes = max(15, min(180, int(round(minutes))))
            sort_order = item.get("sort_order")
            if not isinstance(sort_order, (int, float)):
                sort_order = i + 1
            rat = str(item.get("rationale") or "").strip()
            cleaned.append(
                {
                    "title": title,
                    "description": desc,
                    "estimated_minutes": minutes,
                    "sort_order": int(sort_order),
                    "rationale": rat[:400] if rat else "",
                }
            )
        return cleaned if cleaned else fallback

    try:
        response = invoke_openai_chat(model, [HumanMessage(content=prompt)], "task_generation.generate_assignments_subtasks_batch")
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
            "OPENAI_API_KEY missing or OpenAI chat model unavailable",
        )
        return base

    goals_json = json.dumps(goals)
    prompt = (
        "The user has personal growth / side goals (not graded school work). "
        "Produce concrete, schedulable micro-tasks (e.g. '30 min: Python list comprehensions — 5 exercises', "
        "'Email one alumni for internship info', '45 min leg day: squats + accessories').\n"
        "Avoid vague items like 'get better at X'. Tie each task to one goal.\n"
        "Do NOT include calendar times or dates — only task definitions.\n"
        f"Motivation: {motivation}/100. Low → shorter, gentler tasks; high → can add volume.\n"
        "Cover ALL goals with balanced coverage.\n"
        "Return ONLY valid JSON: an array of objects with keys "
        "title, description, estimated_minutes (20-90), side_goal (must match one of the user's goals), sort_order.\n\n"
        f"goals={goals_json}"
    )

    try:
        response = invoke_openai_chat(model, [HumanMessage(content=prompt)], "task_generation.generate_goal_tasks")
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
