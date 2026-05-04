from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from autojob import db
from autojob.routers import documents, jobs, profile, saved_searches, search


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(title="AutoJob Assistant API", lifespan=lifespan)

_cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
_extra_origins = os.getenv("CORS_ALLOWED_ORIGINS", "")
if _extra_origins:
    _cors_origins += [o.strip() for o in _extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(profile.router)
app.include_router(documents.router)
app.include_router(search.router)
app.include_router(saved_searches.router)
app.include_router(jobs.router)

static_dir = Path("frontend/dist")
if static_dir.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")
