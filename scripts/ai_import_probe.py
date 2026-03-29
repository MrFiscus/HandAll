"""Import probe for start-ai.ps1 — avoids PowerShell mangling python -c strings."""
import importlib
import sys

_MODULES = (
    "uvicorn",
    "fastapi",
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
