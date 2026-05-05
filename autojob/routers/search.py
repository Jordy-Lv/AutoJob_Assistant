from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException

from autojob import db
from autojob.job_sources.registry import health_checks, list_sources
from autojob.models import SearchParams as JobSearchParams
from autojob.schemas import JobSearchPayload, SearchPayload
from autojob.search_engine import run_job_search, search_result_dict


router = APIRouter(prefix="/api")


@router.post("/search/remotive")
def remotive_search(payload: SearchPayload) -> dict[str, Any]:
    query = payload.keywords.strip() or "software developer"
    params = JobSearchParams(query=query, limit=payload.limit, selected_sources=["remotive"])
    result = run_job_search(params)
    return search_result_dict(result)


@router.post("/search/jobs")
async def search_jobs(payload: JobSearchPayload) -> dict[str, Any]:
    if len(payload.query.strip()) < 2:
        raise HTTPException(status_code=400, detail="Escribe una busqueda de al menos 2 caracteres")
    params = JobSearchParams(
        query=payload.query,
        location=payload.location,
        remote_only=payload.remote_only,
        junior_only=payload.junior_only,
        internship_allowed=payload.internship_allowed,
        limit=payload.limit,
        selected_sources=payload.selected_sources,
        date_filter=payload.date_filter,
        page=payload.page,
        auto_analyze=payload.auto_analyze,
    )
    result = await asyncio.to_thread(run_job_search, params, save=payload.save_results)
    return search_result_dict(result)


@router.get("/sources")
def api_sources() -> list[dict[str, Any]]:
    return list_sources()


@router.get("/search/sources")
def list_search_sources() -> dict[str, Any]:
    return {"sources": list_sources()}


@router.get("/search/sources/health")
def search_sources_health() -> dict[str, Any]:
    return {"sources": health_checks()}


@router.get("/search/runs")
def list_search_runs(limit: int = 20) -> dict[str, Any]:
    return {"runs": [asdict(run) for run in db.list_search_runs(limit=limit)]}
