from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from . import db
from .job_sources.base import JobSourceProvider, ProviderError
from .job_sources.registry import select_providers, source_summary
from .models import JobOffer, SearchParams


@dataclass(slots=True)
class SearchEngineResult:
    run_id: int | None
    status: str
    query: str
    jobs: list[JobOffer]
    saved_ids: list[int]
    duplicates: int
    sources: list[dict[str, Any]]
    new_job_ids: list[int]
    updated_job_ids: list[int]

    @property
    def total_found(self) -> int:
        return sum(int(source.get("found") or 0) for source in self.sources)

    @property
    def total_saved(self) -> int:
        return len(self.saved_ids)

    @property
    def total_new(self) -> int:
        return len(self.new_job_ids)

    @property
    def total_updated(self) -> int:
        return len(self.updated_job_ids)

    @property
    def errors(self) -> list[dict[str, Any]]:
        return [
            {"source": source["id"], "message": source.get("error") or source["status"]}
            for source in self.sources
            if source.get("status") not in {"ok"}
        ]


def run_job_search(
    params: SearchParams,
    providers: list[JobSourceProvider] | None = None,
    save: bool = True,
) -> SearchEngineResult:
    normalized_params = normalize_search_params(params)
    if providers is None:
        selected, skipped_sources = select_providers(normalized_params.selected_sources)
    else:
        selected = select_provider_instances(providers, normalized_params.selected_sources)
        skipped_sources = []

    run_params = _run_params_with_selected_sources(normalized_params, selected, skipped_sources)
    run_id = db.create_search_run(run_params) if save else None

    source_summaries: list[dict[str, Any]] = list(skipped_sources)
    seen_keys: set[str] = set()
    response_jobs: list[JobOffer] = []
    saved_ids: list[int] = []
    new_job_ids: list[int] = []
    updated_job_ids: list[int] = []
    duplicates = 0

    if not selected and not skipped_sources:
        source_summaries.append(
            {
                "id": "search",
                "name": "Search",
                "status": "failed",
                "found": 0,
                "saved": 0,
                "duplicates": 0,
                "error": "No hay fuentes habilitadas para esta busqueda",
            }
        )

    for provider in selected:
        summary = source_summary(provider)
        try:
            provider_jobs = provider.search(normalized_params)
        except (ProviderError, Exception) as exc:
            summary.update({"status": "failed", "error": str(exc)})
            source_summaries.append(summary)
            continue

        valid_jobs = [
            job
            for job in filter_jobs(provider_jobs, normalized_params)
            if is_valid_job_result(job)
        ]
        summary["found"] = len(valid_jobs)

        for job in valid_jobs:
            keys = dedupe_keys(job)
            if any(key in seen_keys for key in keys):
                duplicates += 1
                summary["duplicates"] += 1
                continue
            seen_keys.update(keys)
            response_jobs.append(job)

            if not save:
                continue
            job_id, was_inserted = db.upsert_job(job)
            saved_ids.append(job_id)
            if was_inserted:
                new_job_ids.append(job_id)
            else:
                updated_job_ids.append(job_id)
                duplicates += 1
                summary["duplicates"] += 1
            summary["saved"] += 1
            if normalized_params.auto_analyze:
                analyze_saved_job(job_id)

        summary["status"] = "ok"
        summary["error"] = None
        source_summaries.append(summary)

    limited_jobs = response_jobs[: normalized_params.limit]
    status = result_status(limited_jobs, source_summaries)
    if run_id is not None:
        db.finish_search_run(
            run_id,
            status,
            sum(int(source.get("found") or 0) for source in source_summaries),
            len(saved_ids),
            errors=[
                {"source": source["id"], "message": source.get("error") or source["status"]}
                for source in source_summaries
                if source.get("status") != "ok"
            ],
            duplicates=duplicates,
            sources=source_summaries,
        )

    return SearchEngineResult(
        run_id=run_id,
        status=status,
        query=normalized_params.query,
        jobs=limited_jobs,
        saved_ids=saved_ids,
        duplicates=duplicates,
        sources=source_summaries,
        new_job_ids=new_job_ids,
        updated_job_ids=updated_job_ids,
    )


def normalize_search_params(params: SearchParams) -> SearchParams:
    limit = min(max(int(params.limit or 25), 1), 100)
    selected_sources = [source.strip().lower() for source in params.selected_sources if source.strip()]
    return SearchParams(
        query=" ".join((params.query or "").split()),
        location=" ".join((params.location or "").split()),
        remote_only=bool(params.remote_only),
        junior_only=bool(params.junior_only),
        internship_allowed=bool(params.internship_allowed),
        limit=limit,
        selected_sources=selected_sources,
        date_filter=(params.date_filter or "").strip().lower(),
        page=max(int(params.page or 1), 1),
        auto_analyze=bool(params.auto_analyze),
    )


def select_provider_instances(
    providers: list[JobSourceProvider],
    selected_sources: list[str],
) -> list[JobSourceProvider]:
    if not selected_sources:
        return [provider for provider in providers if provider.enabled and provider.is_configured()]
    wanted = {source.lower() for source in selected_sources}
    return [
        provider
        for provider in providers
        if provider.source_id.lower() in wanted and provider.enabled and provider.is_configured()
    ]


def filter_jobs(jobs: list[JobOffer], params: SearchParams) -> list[JobOffer]:
    return [job for job in jobs if job_matches_params(job, params)]


def job_matches_params(job: JobOffer, params: SearchParams) -> bool:
    if params.query and not matches_query(job, params.query):
        return False
    if params.location and not matches_location(job, params.location):
        return False
    if params.remote_only and not job.remote:
        return False
    if not params.internship_allowed and job.employment_type == "internship":
        return False
    if params.junior_only:
        allowed = {"junior", ""}
        if params.internship_allowed:
            allowed.add("internship")
        if job.seniority not in allowed:
            return False
    if params.date_filter and not matches_date_filter(job.published_at, params.date_filter):
        return False
    return True


def is_valid_job_result(job: JobOffer) -> bool:
    if not job.source.strip() or not job.title.strip() or not job.url.strip():
        return False
    if not job.company.strip() and len(job.description.strip()) < 160:
        return False
    return True


def dedupe_jobs(jobs: list[JobOffer]) -> list[JobOffer]:
    seen: set[str] = set()
    unique: list[JobOffer] = []
    for job in jobs:
        keys = dedupe_keys(job)
        if any(key in seen for key in keys):
            continue
        seen.update(keys)
        unique.append(job)
    return unique


def dedupe_keys(job: JobOffer) -> list[str]:
    keys = [f"source:{job.source.lower()}:{job.external_id.lower()}"]
    normalized_url = db.normalize_job_url(job.url)
    if normalized_url:
        keys.append(f"url:{normalized_url}")
    fingerprint = db.job_identity_fingerprint(job.title, job.company, job.location)
    if fingerprint:
        keys.append(f"fingerprint:{fingerprint}")
    return keys


def result_status(jobs: list[JobOffer], sources: list[dict[str, Any]]) -> str:
    hard_failures = [
        source
        for source in sources
        if source.get("status") not in {"ok", "not_configured"}
    ]
    ok_sources = [source for source in sources if source.get("status") == "ok"]
    if hard_failures and not jobs:
        return "failed"
    if hard_failures or any(source.get("status") == "not_configured" for source in sources):
        return "partial"
    if ok_sources:
        return "completed"
    return "failed"


def matches_query(job: JobOffer, query: str) -> bool:
    terms = [term.lower() for term in query.split() if term.strip()]
    haystack = " ".join(
        [
            job.title,
            job.company,
            job.location,
            job.description[:3000],
            " ".join(job.tags),
        ]
    ).lower()
    return all(term in haystack for term in terms)


def matches_location(job: JobOffer, location: str) -> bool:
    location_query = location.lower()
    if location_query in {"remote", "remoto"}:
        return job.remote or "remote" in job.location.lower()
    return location_query in job.location.lower()


def matches_date_filter(value: str, date_filter: str) -> bool:
    if date_filter in {"", "any", "all"}:
        return True
    days = {
        "24h": 1,
        "1d": 1,
        "7d": 7,
        "week": 7,
        "30d": 30,
        "month": 30,
    }.get(date_filter)
    if days is None:
        return True
    parsed = parse_date(value)
    if parsed is None:
        return True
    return parsed >= datetime.now(timezone.utc) - timedelta(days=days)


def parse_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def analyze_saved_job(job_id: int) -> None:
    from .analyzer import analyze_job

    job = db.get_job(job_id)
    if job is None:
        return
    result = analyze_job(db.get_profile(), job)
    db.update_job_analysis(job_id, result.score, result.reasons, result.gaps, result.matched_skills)


def _run_params_with_selected_sources(
    params: SearchParams,
    selected: list[JobSourceProvider],
    skipped: list[dict[str, Any]],
) -> SearchParams:
    if params.selected_sources:
        return params
    return SearchParams(
        query=params.query,
        location=params.location,
        remote_only=params.remote_only,
        junior_only=params.junior_only,
        internship_allowed=params.internship_allowed,
        limit=params.limit,
        selected_sources=[provider.source_id for provider in selected] + [source["id"] for source in skipped],
        date_filter=params.date_filter,
        page=params.page,
        auto_analyze=params.auto_analyze,
    )


def search_result_dict(result: SearchEngineResult) -> dict[str, Any]:
    return {
        "run_id": result.run_id,
        "status": result.status,
        "query": result.query,
        "total_found": result.total_found,
        "total_saved": result.total_saved,
        "duplicates": result.duplicates,
        "saved": result.total_saved,
        "errors": result.errors,
        "sources": result.sources,
        "jobs": [asdict(job) for job in result.jobs],
        "saved_ids": result.saved_ids,
        "new_job_ids": result.new_job_ids,
        "updated_job_ids": result.updated_job_ids,
        "total_new": result.total_new,
        "total_updated": result.total_updated,
    }
