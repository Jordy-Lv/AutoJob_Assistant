from __future__ import annotations

from typing import Any

from autojob.models import JobOffer, SearchParams

from .base import (
    JobSourceProvider,
    clean_html,
    compact,
    dedupe_text,
    infer_seniority,
    normalize_employment_type,
    stable_external_id,
    string_list,
    timestamp_to_iso,
)


class ArbeitnowProvider(JobSourceProvider):
    source_id = "arbeitnow"
    display_name = "Arbeitnow"
    description = "Empleos remotos globales. Sin API key."
    endpoint = "https://www.arbeitnow.com/api/job-board-api"

    def search(self, params: SearchParams) -> list[JobOffer]:
        items: list[dict[str, Any]] = []
        start_page = max(params.page, 1)
        for page in range(start_page, start_page + 3):
            payload = self._get_json(self.endpoint, {"page": page})
            page_items = payload.get("data", []) if isinstance(payload, dict) else []
            items.extend(item for item in page_items if isinstance(item, dict))
            if len(items) >= max(params.limit * 4, params.limit):
                break
        jobs = [self.normalize(item) for item in items if isinstance(item, dict)]
        return jobs[: max(params.limit * 4, params.limit)]

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        tags = string_list(raw_job.get("tags")) + string_list(raw_job.get("job_types"))
        title = compact(raw_job.get("title")) or "Untitled role"
        description = clean_html(raw_job.get("description") or "")
        remote = bool(raw_job.get("remote"))
        return JobOffer(
            source=self.display_name,
            external_id=compact(raw_job.get("slug")) or stable_external_id(raw_job.get("url", ""), title),
            title=title,
            company=compact(raw_job.get("company_name")),
            location=compact(raw_job.get("location")) or ("Remote" if remote else ""),
            url=compact(raw_job.get("url")),
            description=description,
            salary="",
            tags=dedupe_text(tags),
            published_at=timestamp_to_iso(raw_job.get("created_at")),
            remote=remote,
            seniority=infer_seniority(title, description, tags),
            employment_type=normalize_employment_type("", title, tags),
        )

    def _health_request(self) -> None:
        self._get_json(self.endpoint, {"page": 1})
