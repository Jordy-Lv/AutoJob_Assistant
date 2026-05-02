from __future__ import annotations

import os
from typing import Any

from autojob.models import JobOffer, SearchParams

from .base import (
    JobSourceProvider,
    clean_html,
    compact,
    dedupe_text,
    env_is_set,
    infer_seniority,
    missing_env_message,
    normalize_employment_type,
    stable_external_id,
    string_list,
)


class SerpAPIProvider(JobSourceProvider):
    source_id = "serpapi"
    display_name = "SerpAPI Google Jobs"
    requires_api_key = True
    endpoint = "https://serpapi.com/search.json"

    def is_configured(self) -> bool:
        return env_is_set("SERPAPI_KEY")

    def configuration_error(self) -> str | None:
        return None if self.is_configured() else missing_env_message("SERPAPI_KEY")

    def search(self, params: SearchParams) -> list[JobOffer]:
        query = params.query
        if params.remote_only and "remote" not in query.lower():
            query = f"{query} remote"
        location = serpapi_location(params.location)
        payload = self._get_json(
            self.endpoint,
            {
                "engine": "google_jobs",
                "q": query,
                "location": location,
                "api_key": os.getenv("SERPAPI_KEY", ""),
            },
        )
        if isinstance(payload, dict) and payload.get("error"):
            raise RuntimeError(str(payload.get("error")))
        items = payload.get("jobs_results", []) if isinstance(payload, dict) else []
        return [self.normalize(item) for item in items[: max(params.limit, 1)] if isinstance(item, dict)]

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        title = compact(raw_job.get("title")) or "Untitled role"
        description = clean_html(raw_job.get("description") or "")
        extensions = raw_job.get("detected_extensions") or {}
        tags = string_list(raw_job.get("via"))
        schedule = compact(extensions.get("schedule_type"))
        if schedule:
            tags.append(schedule)
        url = first_apply_link(raw_job)
        return JobOffer(
            source=self.display_name,
            external_id=compact(raw_job.get("job_id")) or stable_external_id(url, title, raw_job.get("company_name", "")),
            title=title,
            company=compact(raw_job.get("company_name")),
            location=compact(raw_job.get("location")),
            url=url,
            description=description,
            salary=compact(extensions.get("salary")),
            tags=dedupe_text(tags),
            published_at=compact(raw_job.get("detected_extensions", {}).get("posted_at")),
            remote="remote" in " ".join([title, description, compact(raw_job.get("location"))]).lower(),
            seniority=infer_seniority(title, description, tags),
            employment_type=normalize_employment_type(schedule, title, tags),
        )

    def _health_request(self) -> None:
        self.search(SearchParams(query="developer", limit=1))


def first_apply_link(raw_job: dict[str, Any]) -> str:
    apply_options = raw_job.get("apply_options")
    if isinstance(apply_options, list):
        for option in apply_options:
            if isinstance(option, dict) and compact(option.get("link")):
                return compact(option.get("link"))
    related_links = raw_job.get("related_links")
    if isinstance(related_links, list):
        for link in related_links:
            if isinstance(link, dict) and compact(link.get("link")):
                return compact(link.get("link"))
    return compact(raw_job.get("share_link"))


def serpapi_location(location: str) -> str:
    cleaned = compact(location)
    if cleaned.lower() in {"", "remote", "remoto", "anywhere", "worldwide"}:
        return os.getenv("SERPAPI_LOCATION", "United States").strip() or "United States"
    return cleaned
