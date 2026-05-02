from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from autojob import db
from autojob.routers import documents, jobs, profile, saved_searches, search


app = FastAPI(title="AutoJob Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    db.init_db()


app.include_router(profile.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(saved_searches.router)
app.include_router(jobs.router)

static_dir = Path("frontend/dist")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
