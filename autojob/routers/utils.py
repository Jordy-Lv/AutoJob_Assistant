from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from autojob import db
from autojob.config import OUTPUT_DIR
from autojob.models import STATUS_OPTIONS, JobOffer, UserProfile


NEW_WINDOW_HOURS = 24


def _is_new(value: str) -> bool:
    if not value:
        return False
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed >= datetime.now(timezone.utc) - timedelta(hours=NEW_WINDOW_HOURS)


def job_dict(job: JobOffer) -> dict[str, Any]:
    return {
        "id": job.id,
        "source": job.source,
        "external_id": job.external_id,
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "url": job.url,
        "description": job.description,
        "tags": job.tags,
        "salary": job.salary,
        "published_at": job.published_at,
        "remote": job.remote,
        "seniority": job.seniority,
        "employment_type": job.employment_type,
        "status": job.status,
        "score": job.score,
        "reasons": job.reasons,
        "gaps": job.gaps,
        "matched_skills": job.matched_skills,
        "viewed": job.viewed,
        "first_seen_at": job.first_seen_at,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "display_name": job.display_name,
        "is_new": _is_new(job.first_seen_at),
        "is_analyzed": job.score is not None,
    }


def profile_dict(profile: UserProfile) -> dict[str, str]:
    return asdict(profile)




def counts(jobs: list[JobOffer]) -> dict[str, int]:
    return {status: sum(1 for job in jobs if job.status == status) for status in STATUS_OPTIONS}

def resolve_output_file(raw_path: str) -> Path:
    if not raw_path:
        raise HTTPException(status_code=404, detail="El documento todavia no existe")

    output_root = OUTPUT_DIR.resolve()
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        if candidate.parts and candidate.parts[0].lower() == OUTPUT_DIR.name.lower():
            candidate = (OUTPUT_DIR.parent / candidate).resolve()
        else:
            candidate = (OUTPUT_DIR / candidate).resolve()
    else:
        candidate = candidate.resolve()

    try:
        candidate.relative_to(output_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Documento no permitido") from exc

    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="El documento todavia no existe")

    return candidate


def document_dict(document: dict[str, Any], job: JobOffer | None = None) -> dict[str, Any]:
    document_id = document.get("id")
    filename = Path(str(document.get("path") or "")).name
    download_url = f"/api/documents/{document_id}/download" if document_id is not None else ""
    view_url = f"/api/documents/{document_id}" if document_id is not None else download_url
    public_document = {
        "id": document_id,
        "document_id": document_id,
        "job_id": document.get("job_id") or (job.id if job else None),
        "doc_type": document.get("doc_type", ""),
        "created_at": document.get("created_at", ""),
        "filename": filename,
        "path": download_url,
        "view_url": view_url,
        "download_url": download_url,
    }
    if job is not None:
        public_document.update({"job_title": job.title, "company": job.company})
    return public_document


def documents_for_job(job_id: int) -> list[dict[str, Any]]:
    return [document_dict(document) for document in db.list_documents(job_id)]


def analysis_from_job(job: JobOffer):
    from autojob.analyzer import analyze_job
    from autojob.models import AnalysisResult

    if job.score is None:
        return analyze_job(db.get_profile(), job)
    if job.score >= 80:
        recommendation = "Alta prioridad: preparar aplicacion personalizada."
    elif job.score >= 60:
        recommendation = "Buena opcion: revisar brechas antes de aplicar."
    elif job.score >= 40:
        recommendation = "Posible opcion: requiere ajuste del CV o mas informacion."
    else:
        recommendation = "Baja prioridad: revisar solo si la empresa o el rol interesan mucho."
    return AnalysisResult(job.score, job.reasons, job.gaps, job.matched_skills, recommendation)


def all_documents(jobs: list[JobOffer]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    for job in jobs:
        if job.id is None:
            continue
        for document in db.list_documents(job.id):
            documents.append(document_dict(document, job))
    return documents
