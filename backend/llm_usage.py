"""
Log token usage from LangChain chat model responses (OpenAI via ChatOpenAI → AIMessage).
"""

import logging
from typing import Any, Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage

logger = logging.getLogger(__name__)


def _resolve_openai_model_name(model: Any) -> str:
    """Best-effort model id for logs (ChatOpenAI, RunnableBinding with tools, etc.)."""
    seen: set[int] = set()
    m: Any = model
    for _ in range(10):
        if m is None or id(m) in seen:
            break
        seen.add(id(m))
        for attr in ("model_name", "model"):
            v = getattr(m, attr, None)
            if isinstance(v, str) and v.strip():
                return v.strip()
        kwargs = getattr(m, "kwargs", None)
        if isinstance(kwargs, dict):
            km = kwargs.get("model")
            if isinstance(km, str) and km.strip():
                return km.strip()
        bound = getattr(m, "bound", None)
        if bound is not None:
            m = bound
            continue
        break
    return "unknown"


def _extract_total_tokens(response: Any) -> Optional[int]:
    if not isinstance(response, AIMessage):
        return None
    um = getattr(response, "usage_metadata", None)
    if isinstance(um, dict):
        tt = um.get("total_tokens")
        if isinstance(tt, int):
            return tt
    rm = dict(getattr(response, "response_metadata", None) or {})
    tu = rm.get("token_usage")
    if isinstance(tu, dict):
        tt = tu.get("total_tokens")
        if isinstance(tt, int):
            return tt
    return None


def invoke_openai_chat(model: Any, messages: List[BaseMessage], site: str) -> Any:
    """
    Single entry for OpenAI chat invokes: START / RESPONSE / DONE + token usage logs.
    """
    mn = _resolve_openai_model_name(model)
    logger.info("OPENAI CALL START site=%s model=%s", site, mn)
    response = model.invoke(messages)
    logger.info("OPENAI CALL RESPONSE RECEIVED site=%s model=%s", site, mn)
    log_llm_chat_completion(response, site)
    tt = _extract_total_tokens(response)
    logger.info("OPENAI CALL DONE site=%s model=%s usage.total_tokens=%s", site, mn, tt)
    return response


def log_llm_chat_completion(response: Any, site: str) -> None:
    """Log model + token counts from model.invoke() -> AIMessage."""
    if not isinstance(response, AIMessage):
        logger.info(
            "llm_chat_completion site=%s note=unexpected_message_type type=%s",
            site,
            type(response).__name__,
        )
        return

    rm: Dict[str, Any] = dict(getattr(response, "response_metadata", None) or {})
    model = rm.get("model_name") or rm.get("model")

    pt: Optional[int] = None
    ct: Optional[int] = None
    tt: Optional[int] = None

    um = getattr(response, "usage_metadata", None)
    if isinstance(um, dict):
        pt = um.get("input_tokens")
        ct = um.get("output_tokens")
        tt = um.get("total_tokens")

    tu = rm.get("token_usage")
    if isinstance(tu, dict):
        if pt is None:
            pt = tu.get("prompt_tokens")
        if ct is None:
            ct = tu.get("completion_tokens")
        if tt is None:
            tt = tu.get("total_tokens")

    logger.info(
        "llm_chat_completion site=%s model=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s",
        site,
        model,
        pt,
        ct,
        tt,
    )

    if pt is None and ct is None and tt is None:
        logger.warning(
            "llm_chat_completion site=%s model=%s token_fields_missing=true response_metadata_keys=%s has_usage_metadata=%s",
            site,
            model,
            sorted(rm.keys()) if rm else [],
            um is not None,
        )


def log_llm_fallback(site: str, reason: str) -> None:
    """Call when OpenAI is not invoked (missing key, parse/heuristic fallback, etc.)."""
    logger.warning("OPENAI NOT CALLED — using fallback site=%s reason=%s", site, reason)
