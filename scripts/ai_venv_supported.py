"""Exit 0 if interpreter is Python 3.10-3.12 (HandAll AI stack)."""
import sys

ver = sys.version_info[:2]
raise SystemExit(0 if (3, 10) <= ver <= (3, 12) else 1)
