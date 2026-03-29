"""Shared Google Gemini chat model for planner, task generation, and LangGraph agent."""

import os
from typing import Optional

from langchain_google_genai import ChatGoogleGenerativeAI

from backend.google_model import DEFAULT_GOOGLE_MODEL


def get_gemini_chat_model(temperature: float = 0.2) -> Optional[ChatGoogleGenerativeAI]:
    """Returns None if GOOGLE_API_KEY is missing (callers use heuristics / fallbacks)."""
    key = os.getenv("GOOGLE_API_KEY")
    if not key:
        return None
    return ChatGoogleGenerativeAI(
        model=os.getenv("GOOGLE_MODEL", DEFAULT_GOOGLE_MODEL),
        google_api_key=key,
        temperature=temperature,
    )
