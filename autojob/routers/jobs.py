from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException

from autojob import db
from autojob.ai import analyze_job_with_optional_ai
from autojob.analyzer import analyze_job
from autojob.documents import DOCUMENT_TYPES
from autojob.job_sources import (
    InvalidJobPostingError,
    JobSourceUnavailableError,
    build_job_from_text,
    build_manual_job,
    fetch_job_from_url,
)
from autojob.models import STATUS_OPTIONS, JobOffer, utc_now_iso
from autojob.schemas import (
    AnalyzePayload,
    JobIdsPayload,
    ManualJobPayload,
    StatusPayload,
    TextImportPayload,
    UrlImportPayload,
)

from .utils import documents_for_job, job_dict


router = APIRouter(prefix="/api/jobs")
INVALID_JOB_URL_MESSAGE = "No se pudo detectar una oferta laboral valida en esta URL."


@router.get("")
def list_jobs(
    status: str = "Todos",
    search: str = "",
    min_score: float = 0,
    include_discarded: bool = False,
) -> dict[str, Any]:
    jobs = db.list_jobs(
        status=status,
        search=search,
        min_score=float(min_score) if min_score > 0 else None,
        include_discarded=include_discarded,
    )
    return {"jobs": [job_dict(job) for job in jobs], "statuses": STATUS_OPTIONS}


@router.post("/manual")
def create_manual_job(payload: ManualJobPayload) -> dict[str, Any]:
    job = build_manual_job(
        payload.title,
        payload.company,
        payload.location,
        payload.url,
        payload.description,
        payload.tags,
        payload.salary,
    )
    job_id, _was_inserted = db.upsert_job(job)
    saved = db.get_job(job_id)
    if saved is None:
        raise HTTPException(status_code=500, detail="No se pudo guardar la oferta manual")
    return job_dict(saved)


@router.post("/import-url")
def import_url(payload: UrlImportPayload) -> dict[str, Any]:
    try:
        job = fetch_job_from_url(payload.url, use_browser=payload.use_browser)
    except InvalidJobPostingError as exc:
        raise HTTPException(status_code=422, detail=str(exc) or INVALID_JOB_URL_MESSAGE) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except JobSourceUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc) or "La fuente no respondio") from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"La fuente no respondio: {exc}") from exc

    job_id, _was_inserted = db.upsert_job(job)
    saved = db.get_job(job_id)
    if saved is None:
        raise HTTPException(status_code=500, detail="No se pudo guardar la oferta importada")
    return job_dict(saved)


@router.post("/import-text")
def import_text(payload: TextImportPayload) -> dict[str, Any]:
    job = build_job_from_text(
        raw_text=payload.raw_text,
        url=payload.url,
        title=payload.title,
        company=payload.company,
        location=payload.location,
    )
    job_id, _was_inserted = db.upsert_job(job)
    saved = db.get_job(job_id)
    if saved is None:
        raise HTTPException(status_code=500, detail="No se pudo guardar la oferta capturada")
    return job_dict(saved)


@router.get("/{job_id}")
def get_job(job_id: int) -> dict[str, Any]:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    return {
        "job": job_dict(job),
        "documents": documents_for_job(job_id),
        "applications": [asdict(application) for application in db.list_application_history(job_id)],
    }


@router.patch("/{job_id}/status")
def update_status(job_id: int, payload: StatusPayload) -> dict[str, Any]:
    if payload.status not in STATUS_OPTIONS:
        raise HTTPException(status_code=400, detail="Estado invalido")
    db.update_job_status(job_id, payload.status)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    return job_dict(job)


@router.post("/{job_id}/discard")
def discard_job(job_id: int) -> dict[str, Any]:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    db.update_job_status(job_id, "Descartada")
    discarded = db.get_job(job_id) or job
    return {
        "job": job_dict(discarded),
        "message": "Oferta descartada. No volvera a aparecer en nuevas busquedas.",
    }


@router.post("/discard-bulk")
def discard_jobs(payload: JobIdsPayload) -> dict[str, Any]:
    unique_ids = sorted({int(job_id) for job_id in payload.ids if int(job_id) > 0})
    discarded: list[int] = []
    skipped: list[int] = []
    for job_id in unique_ids:
        job = db.get_job(job_id)
        if job is None or job.status in {"Aplicada", "Descartada"}:
            skipped.append(job_id)
            continue
        db.update_job_status(job_id, "Descartada")
        discarded.append(job_id)
    return {
        "discarded": discarded,
        "discarded_count": len(discarded),
        "skipped": skipped,
        "message": f"{len(discarded)} ofertas descartadas.",
    }


@router.patch("/{job_id}/viewed")
def mark_viewed(job_id: int) -> dict[str, Any]:
    db.mark_job_viewed(job_id)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    return job_dict(job)


@router.post("/{job_id}/analyze")
def analyze(job_id: int, payload: AnalyzePayload) -> dict[str, Any]:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    if job.status == "Descartada":
        raise HTTPException(status_code=400, detail="Esta oferta esta descartada.")
    profile = db.get_profile()
    result = analyze_job_with_optional_ai(profile, job, payload.use_ai)
    db.update_job_analysis(job_id, result.score, result.reasons, result.gaps, result.matched_skills)
    refreshed = db.get_job(job_id)
    return job_dict(refreshed or job)


@router.post("/{job_id}/documents")
async def documents(job_id: int) -> dict[str, Any]:
    import asyncio

    return await asyncio.to_thread(_generate_documents, job_id)


def _generate_documents(job_id: int) -> dict[str, Any]:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    if job.status == "Descartada":
        raise HTTPException(status_code=400, detail="Esta oferta esta descartada.")
    if job.score is None:
        profile = db.get_profile()
        analysis = analyze_job(profile, job)
        db.update_job_analysis(job_id, analysis.score, analysis.reasons, analysis.gaps, analysis.matched_skills)
    db.delete_documents_for_job(job_id)
    for doc_type in DOCUMENT_TYPES:
        db.add_document(job_id, doc_type, "")
    return {"documents": documents_for_job(job_id)}


@router.delete("/{job_id}", status_code=204)
def delete_job(job_id: int) -> None:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    db.delete_job(job_id)


@router.post("/{job_id}/apply")
def mark_as_applied(job_id: int) -> dict[str, Any]:
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Oferta no encontrada")
    if job.status == "Descartada":
        raise HTTPException(status_code=400, detail="Esta oferta esta descartada.")
    db.update_job_status(job_id, "Aplicada")
    documents_used = [
        document.get("path", "")
        for document in db.list_documents(job_id)
        if document.get("path")
    ]
    application_id = db.create_application(
        job_id=job_id,
        status="Aplicada",
        portal=job.source,
        url=job.url,
        documents_used=documents_used,
        log=[
            {
                "time": utc_now_iso(),
                "event": "manual",
                "message": "Marcada como aplicada manualmente.",
            }
        ],
    )
    return {
        "status": "Aplicada",
        "message": "Oferta marcada como aplicada manualmente.",
        "application_id": application_id,
    }


