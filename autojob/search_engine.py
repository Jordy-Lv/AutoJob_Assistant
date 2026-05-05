from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Any

from . import db
from .job_sources.base import JobSourceProvider, ProviderError
from .job_sources.registry import select_providers, source_summary
from .models import JobOffer, SearchParams, UserProfile


@dataclass(slots=True)
class SearchEngineResult:
    run_id: int | None
    status: str
    query: str
    jobs: list[JobOffer]
    saved_ids: list[int]
    duplicates: int
    discarded_ids: list[int]
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
    def total_discarded(self) -> int:
        return len(self.discarded_ids)

    @property
    def total_expired(self) -> int:
        return sum(int(source.get("expired") or 0) for source in self.sources)

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
    discarded_ids: list[int] = []
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
                "discarded": 0,
                "expired": 0,
                "error": "No hay fuentes habilitadas para esta busqueda",
            }
        )

    profile = db.get_profile() if normalized_params.auto_analyze else None

    if selected:
        with ThreadPoolExecutor(max_workers=len(selected)) as executor:
            futures = {executor.submit(_call_provider, provider, normalized_params): provider for provider in selected}
            for future in as_completed(futures):
                provider, result = future.result()
                summary = source_summary(provider)
                summary["expired"] = int(getattr(provider, "last_expired_count", 0) or 0)
                if isinstance(result, Exception):
                    summary.update({"status": "failed", "error": str(result)})
                    source_summaries.append(summary)
                    continue

                valid_jobs = [
                    job
                    for job in filter_jobs(result, normalized_params)
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

                    if save:
                        discarded_id = db.find_discarded_job_id(job)
                        if discarded_id is not None:
                            discarded_ids.append(discarded_id)
                            summary["discarded"] = int(summary.get("discarded") or 0) + 1
                            continue

                    response_jobs.append(job)

                    if not save:
                        continue
                    existing_id = db.find_duplicate_job_id(job)
                    if existing_id is not None:
                        duplicates += 1
                        summary["duplicates"] += 1
                        continue
                    job_id, was_inserted = db.upsert_job(job)
                    saved_ids.append(job_id)
                    if was_inserted:
                        new_job_ids.append(job_id)
                    else:
                        updated_job_ids.append(job_id)
                    summary["saved"] += 1
                    if profile is not None:
                        analyze_saved_job(job_id, profile=profile)

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
        discarded_ids=discarded_ids,
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
    if not terms:
        return True
    haystack = " ".join(
        [
            job.title,
            job.company,
            job.location,
            job.description[:3000],
            " ".join(job.tags),
        ]
    ).lower()
    matched = sum(1 for term in terms if term in haystack)
    threshold = max(1, round(len(terms) * 0.6))
    return matched >= threshold


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
        "2d": 2,
        "3d": 3,
        "4d": 4,
        "7d": 7,
        "week": 7,
        "14d": 14,
        "30d": 30,
        "month": 30,
    }.get(date_filter)
    if days is None:
        return True
    if not value or not value.strip():
        return False
    parsed = parse_date(value)
    if parsed is None:
        return False
    return parsed >= datetime.now(timezone.utc) - timedelta(days=days)


_RELATIVE_DATE_RE = re.compile(
    r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago",
    re.IGNORECASE,
)
# Spanish: "hace 2 días", "hace 3 horas", "hace 1 semana"
_SPANISH_RELATIVE_RE = re.compile(
    r"hace\s+(\d+)\s*(segundo|minuto|hora|d[ií]a|semana|mes|a[ñn]o)s?",
    re.IGNORECASE,
)
_UNIT_DAYS: dict[str, int] = {
    # English
    "second": 0, "minute": 0, "hour": 0,
    "day": 1, "week": 7, "month": 30, "year": 365,
    # Spanish
    "segundo": 0, "minuto": 0, "hora": 0,
    "dia": 1, "día": 1, "semana": 7, "mes": 30, "año": 365, "ano": 365,
}
_TODAY_STRINGS = frozenset([
    "just posted", "today", "just now", "ahora", "hoy",
    "ahora mismo", "recién publicada", "recien publicada",
    "nueva", "newly posted",
])
_YESTERDAY_STRINGS = frozenset(["yesterday", "ayer"])


def parse_date(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None

    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        pass

    now = datetime.now(timezone.utc)
    lowered = text.lower()
    if lowered in _TODAY_STRINGS:
        return now
    if lowered in _YESTERDAY_STRINGS:
        return now - timedelta(days=1)

    m = _RELATIVE_DATE_RE.search(lowered)
    if m:
        amount = int(m.group(1))
        unit = m.group(2).lower().rstrip("s")
        days = _UNIT_DAYS.get(unit, 0) * amount
        return now - timedelta(days=days)

    m = _SPANISH_RELATIVE_RE.search(lowered)
    if m:
        amount = int(m.group(1))
        unit = m.group(2).lower()
        days = _UNIT_DAYS.get(unit, _UNIT_DAYS.get(unit.rstrip("s"), 0)) * amount
        return now - timedelta(days=days)

    return parse_named_date(text)


def parse_named_date(value: str) -> datetime | None:
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%b %d", "%B %d"):
        try:
            parsed = datetime.strptime(value, fmt)
        except ValueError:
            continue
        if "%Y" not in fmt:
            parsed = parsed.replace(year=datetime.now(timezone.utc).year)
        return parsed.replace(tzinfo=timezone.utc)
    return None


def _call_provider(provider: JobSourceProvider, params: SearchParams) -> tuple[JobSourceProvider, list[JobOffer] | Exception]:
    try:
        return provider, provider.search(params)
    except Exception as exc:
        return provider, exc


def analyze_saved_job(job_id: int, profile: UserProfile | None = None) -> None:
    from .analyzer import analyze_job

    job = db.get_job(job_id)
    if job is None:
        return
    result = analyze_job(profile or db.get_profile(), job)
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
        "discarded": result.total_discarded,
        "expired": result.total_expired,
        "saved": result.total_saved,
        "errors": result.errors,
        "sources": result.sources,
        "jobs": [asdict(job) for job in result.jobs],
        "saved_ids": result.saved_ids,
        "discarded_ids": result.discarded_ids,
        "new_job_ids": result.new_job_ids,
        "updated_job_ids": result.updated_job_ids,
        "total_new": result.total_new,
        "total_updated": result.total_updated,
    }
