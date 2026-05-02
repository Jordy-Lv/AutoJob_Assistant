from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException

from autojob import db
from autojob.models import SavedSearch, SearchParams
from autojob.schemas import SavedSearchPayload
from autojob.search_engine import run_job_search, search_result_dict


router = APIRouter(prefix="/api/saved-searches")


def _payload_to_saved_search(payload: SavedSearchPayload) -> SavedSearch:
    return SavedSearch(
        name=payload.name,
        query=payload.query,
        location=payload.location,
        remote_only=payload.remote_only,
        junior_only=payload.junior_only,
        internship_allowed=payload.internship_allowed,
        selected_sources=list(payload.selected_sources),
        date_filter=payload.date_filter,
        score_threshold=float(payload.score_threshold),
        interval_minutes=int(payload.interval_minutes),
        enabled=bool(payload.enabled),
    )


def _saved_search_to_params(search: SavedSearch, limit: int = 50) -> SearchParams:
    return SearchParams(
        query=search.query,
        location=search.location,
        remote_only=search.remote_only,
        junior_only=search.junior_only,
        internship_allowed=search.internship_allowed,
        limit=limit,
        selected_sources=list(search.selected_sources),
        date_filter=search.date_filter,
        page=1,
        auto_analyze=True,
    )


@router.get("")
def list_saved_searches(only_enabled: bool = False) -> dict[str, Any]:
    return {
        "saved_searches": [asdict(search) for search in db.list_saved_searches(only_enabled=only_enabled)]
    }


@router.post("", status_code=201)
def create_saved_search(payload: SavedSearchPayload) -> dict[str, Any]:
    search = _payload_to_saved_search(payload)
    saved_id = db.create_saved_search(search)
    saved = db.get_saved_search(saved_id)
    if saved is None:
        raise HTTPException(status_code=500, detail="No se pudo crear la búsqueda guardada")
    return asdict(saved)


@router.get("/{saved_search_id}")
def get_saved_search(saved_search_id: int) -> dict[str, Any]:
    saved = db.get_saved_search(saved_search_id)
    if saved is None:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    return asdict(saved)


@router.put("/{saved_search_id}")
def update_saved_search(saved_search_id: int, payload: SavedSearchPayload) -> dict[str, Any]:
    if db.get_saved_search(saved_search_id) is None:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    db.update_saved_search(saved_search_id, _payload_to_saved_search(payload))
    saved = db.get_saved_search(saved_search_id)
    if saved is None:
        raise HTTPException(status_code=500, detail="No se pudo actualizar la búsqueda guardada")
    return asdict(saved)


@router.delete("/{saved_search_id}", status_code=204)
def delete_saved_search(saved_search_id: int) -> None:
    if db.get_saved_search(saved_search_id) is None:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    db.delete_saved_search(saved_search_id)


@router.post("/{saved_search_id}/run")
def run_saved_search(saved_search_id: int) -> dict[str, Any]:
    saved = db.get_saved_search(saved_search_id)
    if saved is None:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    if not saved.enabled:
        raise HTTPException(status_code=400, detail="La búsqueda está deshabilitada")

    params = _saved_search_to_params(saved)
    result = run_job_search(params)

    db.mark_saved_search_run(
        saved_search_id,
        status=result.status,
        baseline_done=True if not saved.baseline_done else None,
    )
    return {
        "saved_search_id": saved_search_id,
        "baseline_done_before_run": saved.baseline_done,
        "search_result": search_result_dict(result),
    }


@router.get("/{saved_search_id}/notifications")
def list_notifications(saved_search_id: int, limit: int = 100) -> dict[str, Any]:
    if db.get_saved_search(saved_search_id) is None:
        raise HTTPException(status_code=404, detail="Búsqueda no encontrada")
    return {
        "notifications": [asdict(notification) for notification in db.list_notifications(saved_search_id, limit)]
    }
