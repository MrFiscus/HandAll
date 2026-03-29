"""
AI-only calendar understanding: classify events and enrich metadata.
Scheduling stays in planner.py / server.js (deterministic).
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from langchain_core.messages import HumanMessage

from backend.llm_client import get_openai_chat_model
from backend.llm_usage import invoke_openai_chat, log_llm_fallback


VALID_CLASSES = (
    "protected_fixed",
    "assignment_deadline",
    "optional_personal",
    "unclear",
)


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


def _map_to_task_type(classification: str) -> str:
    """Map AI class to SQLite task.type used by planner + UI."""
    c = (classification or "").strip().lower()
    if c == "assignment_deadline":
        return "assignment"
    if c == "optional_personal":
        return "flexible"
    if c == "protected_fixed":
        return "fixed"
    if c == "unclear":
        return "external"
    return "external"


def classify_calendar_events_batch(
    events: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    One LLM call for up to ~40 events. Each event needs: id, title, description?, start, end.

    Returns list of dicts with:
      id, classification, confidence, subtype, reason, mapped_task_type
    """
    if not events:
        return []

    model = get_openai_chat_model(temperature=0.12)
    if not model:
        log_llm_fallback(
            "calendar_intelligence.classify_calendar_events_batch",
            "OPENAI_API_KEY missing",
        )
        return _heuristic_classify(events)

    payload = []
    for ev in events:
        payload.append(
            {
                "id": str(ev.get("id") or ""),
                "title": str(ev.get("title") or ""),
                "description": str(ev.get("description") or "")[:1200],
                "start": str(ev.get("start") or ""),
                "end": str(ev.get("end") or ""),
            }
        )

    prompt = (
        "You classify student calendar events for scheduling assistance.\n"
        "Rules:\n"
        "- protected_fixed: immovable commitments — classes, labs, work shifts, meetings, "
        "appointments, exams taken at a fixed time, interviews, travel blocks.\n"
        "- assignment_deadline: academic work due — homework, projects, papers, presentations, "
        "lab reports, submissions. Often title contains 'due', 'submit', assignment name, or it is "
        "an all-day or short deadline marker.\n"
        "- optional_personal: wellness or hobby blocks the student could reschedule — gym, reading, "
        "optional club socials, flexible self-care (NOT exams or graded deadlines).\n"
        "- unclear: low confidence — default safe behavior: treat like protected_fixed for blocking time.\n"
        "For each event output: id (exact match), classification, confidence (0-1), subtype (short phrase), "
        "reason (one sentence, why you chose this class).\n"
        "Return ONLY valid JSON: { \"results\": [ { \"id\", \"classification\", \"confidence\", \"subtype\", \"reason\" } ] }\n\n"
        f"events={json.dumps(payload, indent=2)}"
    )

    try:
        response = invoke_openai_chat(model, [HumanMessage(content=prompt)], "calendar_intelligence.classify_calendar_events_batch")
        parsed = _extract_json_object(str(response.content))
        if not isinstance(parsed, dict):
            log_llm_fallback(
                "calendar_intelligence.classify_calendar_events_batch",
                "parse failed; heuristic classify",
            )
            return _heuristic_classify(events)

        results = parsed.get("results")
        if not isinstance(results, list):
            return _heuristic_classify(events)

        by_id: Dict[str, Dict[str, Any]] = {}
        for item in results:
            if not isinstance(item, dict):
                continue
            eid = str(item.get("id") or "").strip()
            if not eid:
                continue
            raw_cls = str(item.get("classification") or "").strip().lower()
            if raw_cls not in VALID_CLASSES:
                raw_cls = "unclear"
            conf = item.get("confidence")
            try:
                cf = float(conf) if conf is not None else 0.5
            except (TypeError, ValueError):
                cf = 0.5
            cf = max(0.0, min(1.0, cf))
            by_id[eid] = {
                "id": eid,
                "classification": raw_cls,
                "confidence": cf,
                "subtype": str(item.get("subtype") or "")[:120],
                "reason": str(item.get("reason") or "")[:500],
                "mapped_task_type": _map_to_task_type(raw_cls),
            }

        out: List[Dict[str, Any]] = []
        for ev in events:
            eid = str(ev.get("id") or "")
            if eid in by_id:
                out.append(by_id[eid])
            else:
                out.append(
                    {
                        "id": eid,
                        "classification": "unclear",
                        "confidence": 0.35,
                        "subtype": "missing from model output",
                        "reason": "Model omitted this id; defaulting to unclear.",
                        "mapped_task_type": "external",
                    }
                )
        return out
    except Exception as exc:
        log_llm_fallback(
            "calendar_intelligence.classify_calendar_events_batch",
            f"exception: {exc!s}"[:300],
        )
        return _heuristic_classify(events)


def _heuristic_classify(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for ev in events:
        combined = f"{ev.get('title', '')} {ev.get('description', '')}".lower()
        if re.search(r"\b(due|submit|assignment|homework|project|paper|report|midterm|final exam)\b", combined):
            cls = "assignment_deadline"
        elif re.search(r"\b(class|lecture|lab section|work shift|meeting|interview|appointment)\b", combined):
            cls = "protected_fixed"
        else:
            cls = "unclear"
        out.append(
            {
                "id": str(ev.get("id") or ""),
                "classification": cls,
                "confidence": 0.45,
                "subtype": "heuristic",
                "reason": "Keyword heuristic (no API key or parse failure).",
                "mapped_task_type": _map_to_task_type(cls),
            }
        )
    return out
