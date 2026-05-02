from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter

from autojob import db
from autojob.ai import has_ai_credentials
from autojob.models import UserProfile
from autojob.schemas import ProfilePayload

from .utils import all_documents, counts, job_dict, profile_dict


router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, Any]:
    return {
        "database": db.check_database_health(),
        "ai": {
            "openai_configured": has_ai_credentials(),
            "mode": "local heuristic" if not has_ai_credentials() else "optional API",
        },
    }


@router.get("/profile")
def get_profile() -> dict[str, str]:
    return profile_dict(db.get_profile())


@router.post("/profile")
def save_profile(payload: ProfilePayload) -> dict[str, str]:
    profile = UserProfile(**payload.model_dump())
    db.save_profile(profile)
    return profile_dict(db.get_profile())


@router.get("/overview")
def overview() -> dict[str, Any]:
    jobs = db.list_jobs()
    documents = all_documents(jobs)
    status_counts = counts(jobs)
    analyzed = [job for job in jobs if job.score is not None]
    unanalyzed = [job for job in jobs if job.score is None and job.status not in ("Aplicada", "Descartada")]
    avg_score = round(sum(job.score or 0 for job in analyzed) / len(analyzed), 1) if analyzed else 0
    document_job_ids = {doc.get("job_id") for doc in documents}
    high_priority = [
        job for job in jobs
        if (job.score or 0) >= 80 and job.status not in ("Aplicada", "Descartada")
    ]
    new_jobs = [job for job in jobs if job_dict(job)["is_new"]]
    ready_to_apply = [
        job for job in jobs
        if job.status == "Lista para aplicar" or (job.id in document_job_ids and job.status not in ("Aplicada", "Descartada"))
    ]

    return {
        "health": db.check_database_health(),
        "total_jobs": len(jobs),
        "counts": status_counts,
        "avg_score": avg_score,
        "high_priority_count": len(high_priority),
        "unanalyzed_count": len(unanalyzed),
        "new_count": len(new_jobs),
        "ready_to_apply_count": len(ready_to_apply),
        "applied_count": status_counts.get("Aplicada", 0),
        "recent_jobs": [job_dict(job) for job in jobs[:8]],
        "priority_jobs": [job_dict(job) for job in high_priority[:6]],
        "ready_jobs": [job_dict(job) for job in ready_to_apply[:6]],
        "new_jobs": [job_dict(job) for job in new_jobs[:6]],
        "documents_count": len(documents),
        "documents": documents[:12],
    }
