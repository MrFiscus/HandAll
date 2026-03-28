import os
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

ROOT_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(ROOT_ENV_FILE, override=True)

if not os.getenv("SUPABASE_KEY") and os.getenv("SUPABASE_ANON_KEY"):
    os.environ["SUPABASE_KEY"] = os.environ["SUPABASE_ANON_KEY"]

app = FastAPI(title="HandAll AI Agent Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    user_id: str
    thread_id: str
    message: str


class ChatResponse(BaseModel):
    response: str
    user_id: str
    thread_id: str


class ProfileSyncRequest(BaseModel):
    user_id: str
    name: str = "Student"
    timezone: str = "UTC"
    prefs: Dict[str, Any]


@app.get("/")
def root() -> Dict[str, str]:
    return {"message": "HandAll AI backend is running", "docs": "/docs"}


@app.get("/health")
def health_check() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/profile/sync")
def sync_profile(request: ProfileSyncRequest) -> Dict[str, Any]:
    try:
        from backend.agent import upsert_user_profile

        profile = upsert_user_profile(
            user_id=request.user_id,
            name=request.name,
            timezone_name=request.timezone,
            prefs=request.prefs,
        )
        return {"success": True, "profile": profile}
    except Exception as exc:
        return {
            "success": False,
            "error": str(exc),
            "profile": {
                "id": request.user_id,
                "name": request.name,
                "timezone": request.timezone,
                "prefs": request.prefs,
            },
        }


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> Dict[str, Any]:
    try:
        if not os.getenv("GOOGLE_API_KEY"):
            result = {
                "response": (
                    "The AI backend is connected, but `GOOGLE_API_KEY` is not configured yet. "
                    "Add it to the root `.env` file to enable real AI responses."
                )
            }
        else:
            from backend.agent import run_agent

            result = run_agent(
                user_id=request.user_id,
                thread_id=request.thread_id,
                message=request.message,
            )
    except Exception as exc:
        result = {
            "response": (
                "The AI backend is running, but it's missing required configuration or hit an internal error. "
                f"Details: {exc}"
            )
        }
    return {
        "response": result["response"],
        "user_id": request.user_id,
        "thread_id": request.thread_id,
    }
