from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.agent import run_agent, upsert_user_profile


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
    profile = upsert_user_profile(
        user_id=request.user_id,
        name=request.name,
        timezone_name=request.timezone,
        prefs=request.prefs,
    )
    return {"success": True, "profile": profile}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> Dict[str, Any]:
    result = run_agent(
        user_id=request.user_id,
        thread_id=request.thread_id,
        message=request.message,
    )
    return {
        "response": result["response"],
        "user_id": request.user_id,
        "thread_id": request.thread_id,
    }
