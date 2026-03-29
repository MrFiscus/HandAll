"""Shared OpenAI chat model for planner, task generation, LangGraph agent, and calendar intelligence."""

import os
from typing import Optional

from langchain_openai import ChatOpenAI

from backend.openai_model import DEFAULT_OPENAI_MODEL


def get_openai_chat_model(temperature: float = 0.2) -> Optional[ChatOpenAI]:
    """Returns None if OPENAI_API_KEY is missing (callers use heuristics / fallbacks)."""
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        return None
    model_name = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    return ChatOpenAI(
        model=model_name,
        api_key=key,
        temperature=temperature,
    )
