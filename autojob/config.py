from __future__ import annotations

import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
OUTPUT_DIR = BASE_DIR / "outputs"
BROWSER_PROFILE_DIR = DATA_DIR / "browser-profile"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
DEFAULT_DATABASE_URL = "postgresql+psycopg://autojob:autojob@localhost:5432/autojob"

try:
    from dotenv import load_dotenv
except ImportError:  # The app still works before dependencies are installed.
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv(BASE_DIR / ".env")


def database_url() -> str:
    return os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
