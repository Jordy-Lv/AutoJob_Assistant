from __future__ import annotations

import json
import logging
import os

from .analyzer import analyze_job
from .models import AnalysisResult, JobOffer, UserProfile


DEFAULT_MODEL = "gpt-4.1-mini"


def has_ai_credentials() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def analyze_job_with_optional_ai(
    profile: UserProfile,
    job: JobOffer,
    use_ai: bool,
) -> AnalysisResult:
    fallback = analyze_job(profile, job)
    if not use_ai or not has_ai_credentials():
        return fallback

    try:
        from openai import OpenAI

        client = OpenAI()
        system_prompt = (
            "Eres un asistente de carrera para desarrolladores de software. "
            "Responde solo JSON valido con: score, reasons, gaps, "
            "matched_skills, recommendation. score debe ser 0-100."
        )
        user_prompt = json.dumps(
            {
                "profile": {
                    "target_role": profile.target_role,
                    "summary": profile.summary,
                    "skills": profile.skills,
                    "experience": profile.experience,
                    "projects": profile.projects,
                    "keywords": profile.keywords,
                },
                "job": {
                    "title": job.title,
                    "company": job.company,
                    "location": job.location,
                    "description": job.description[:9000],
                    "tags": job.tags,
                },
                "local_baseline": {
                    "score": fallback.score,
                    "reasons": fallback.reasons,
                    "gaps": fallback.gaps,
                    "matched_skills": fallback.matched_skills,
                    "recommendation": fallback.recommendation,
                },
            },
            ensure_ascii=False,
        )
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", DEFAULT_MODEL),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        payload = json.loads(response.choices[0].message.content or "{}")
        return AnalysisResult(
            score=round(float(payload.get("score", fallback.score)), 1),
            reasons=_clean_list(payload.get("reasons")) or fallback.reasons,
            gaps=_clean_list(payload.get("gaps")) or fallback.gaps,
            matched_skills=_clean_list(payload.get("matched_skills")) or fallback.matched_skills,
            recommendation=str(payload.get("recommendation") or fallback.recommendation),
        )
    except Exception as exc:
        logging.getLogger(__name__).warning("OpenAI analysis failed: %s", exc)
        return fallback


def _clean_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]
