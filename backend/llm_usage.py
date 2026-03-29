"""
Log token usage from LangChain chat model responses (Gemini via ChatGoogleGenerativeAI → AIMessage).
"""

import logging
from typing import Any, Dict, Optional

from langchain_core.messages import AIMessage

logger = logging.getLogger(__name__)


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
    """Call when the LLM is not invoked (missing key or explicit heuristic path)."""
    logger.warning("llm_skipped site=%s reason=%s", site, reason)
