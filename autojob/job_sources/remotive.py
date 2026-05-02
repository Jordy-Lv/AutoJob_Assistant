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
)


class RemotiveProvider(JobSourceProvider):
    source_id = "remotive"
    display_name = "Remotive"
    endpoint = "https://remotive.com/api/remote-jobs"

    def search(self, params: SearchParams) -> list[JobOffer]:
        payload = self._get_json(
            self.endpoint,
            {
                "search": params.query,
                "limit": min(max(params.limit, 1), 50),
            },
        )
        return [self.normalize(item) for item in payload.get("jobs", []) if isinstance(item, dict)]

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        tags = string_list(raw_job.get("tags"))
        job_type = compact(raw_job.get("job_type"))
        if raw_job.get("category"):
            tags.append(compact(raw_job.get("category")))
        if job_type:
            tags.append(job_type)
        title = compact(raw_job.get("title")) or "Untitled role"
        description = clean_html(raw_job.get("description") or "")
        return JobOffer(
            source=self.display_name,
            external_id=str(raw_job.get("id") or stable_external_id(raw_job.get("url", ""), title)),
            title=title,
            company=compact(raw_job.get("company_name")),
            location=compact(raw_job.get("candidate_required_location")) or "Remote",
            url=compact(raw_job.get("url")),
            description=description,
            salary=compact(raw_job.get("salary")),
            tags=dedupe_text(tags),
            published_at=compact(raw_job.get("publication_date")),
            remote=True,
            seniority=infer_seniority(title, description, tags),
            employment_type=normalize_employment_type(job_type, title, tags),
        )

    def _health_request(self) -> None:
        self._get_json(self.endpoint, {"limit": 1})
