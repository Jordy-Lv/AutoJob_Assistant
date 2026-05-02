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


class RemoteOKProvider(JobSourceProvider):
    source_id = "remoteok"
    display_name = "RemoteOK"
    endpoint = "https://remoteok.com/api"
    retries = 0

    def search(self, params: SearchParams) -> list[JobOffer]:
        payload = self._get_json(self.endpoint)
        items = payload if isinstance(payload, list) else []
        jobs = [
            self.normalize(item)
            for item in items
            if isinstance(item, dict) and item.get("id") and item.get("position")
        ]
        return jobs[: max(params.limit * 3, params.limit)]

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        tags = string_list(raw_job.get("tags"))
        title = compact(raw_job.get("position")) or "Untitled role"
        description = clean_html(raw_job.get("description") or "")
        return JobOffer(
            source=self.display_name,
            external_id=str(raw_job.get("id") or stable_external_id(raw_job.get("url", ""), title)),
            title=title,
            company=compact(raw_job.get("company")),
            location=compact(raw_job.get("location")) or "Remote",
            url=compact(raw_job.get("url") or raw_job.get("apply_url")),
            description=description,
            salary=remoteok_salary(raw_job),
            tags=dedupe_text(tags),
            published_at=compact(raw_job.get("date")) or timestamp_to_iso(raw_job.get("epoch")),
            remote=True,
            seniority=infer_seniority(title, description, tags),
            employment_type=normalize_employment_type("", title, tags),
        )

    def _health_request(self) -> None:
        self._get_json(self.endpoint)


def remoteok_salary(raw_job: dict[str, Any]) -> str:
    minimum = raw_job.get("salary_min")
    maximum = raw_job.get("salary_max")
    parts = [str(value) for value in (minimum, maximum) if value not in (None, "", 0)]
    return " - ".join(parts)
