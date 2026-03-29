"""Import probe for start-ai.ps1 — validates FastAPI stack including pydantic_core."""
import importlib
import sys

_MODULES = (
    "uvicorn",
    "fastapi",
    "pydantic",
    "pydantic_core",  # loads native _pydantic_core; fails if wheel missing for this Python
    "google.oauth2",
    "googleapiclient.discovery",
    "langchain_openai",
    "tzdata",
)


def main() -> int:
    for name in _MODULES:
        importlib.import_module(name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
