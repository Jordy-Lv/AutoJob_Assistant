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


class AdzunaProvider(JobSourceProvider):
    source_id = "adzuna"
    display_name = "Adzuna"
    requires_api_key = True
    endpoint_template = "https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"

    def is_configured(self) -> bool:
        return env_is_set("ADZUNA_APP_ID", "ADZUNA_APP_KEY")

    def configuration_error(self) -> str | None:
        return None if self.is_configured() else missing_env_message("ADZUNA_APP_ID", "ADZUNA_APP_KEY")

    def search(self, params: SearchParams) -> list[JobOffer]:
        country = os.getenv("ADZUNA_COUNTRY", "us").strip().lower() or "us"
        payload = self._get_json(
            self.endpoint_template.format(country=country, page=max(params.page, 1)),
            {
                "app_id": os.getenv("ADZUNA_APP_ID", ""),
                "app_key": os.getenv("ADZUNA_APP_KEY", ""),
                "results_per_page": min(max(params.limit, 1), 50),
                "what": params.query,
                "where": params.location,
                "content-type": "application/json",
                "sort_by": "date",
            },
        )
        results = payload.get("results", []) if isinstance(payload, dict) else []
        return [self.normalize(item) for item in results if isinstance(item, dict)]

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        title = compact(raw_job.get("title")) or "Untitled role"
        description = clean_html(raw_job.get("description") or "")
        tags = string_list((raw_job.get("category") or {}).get("label"))
        contract_type = compact(raw_job.get("contract_type"))
        contract_time = compact(raw_job.get("contract_time"))
        if contract_type:
            tags.append(contract_type)
        if contract_time:
            tags.append(contract_time)
        return JobOffer(
            source=self.display_name,
            external_id=str(raw_job.get("id") or stable_external_id(raw_job.get("redirect_url", ""), title)),
            title=title,
            company=compact((raw_job.get("company") or {}).get("display_name")),
            location=compact((raw_job.get("location") or {}).get("display_name")),
            url=compact(raw_job.get("redirect_url")),
            description=description,
            salary=adzuna_salary(raw_job),
            tags=dedupe_text(tags),
            published_at=compact(raw_job.get("created")),
            remote="remote" in " ".join([title, description, compact((raw_job.get("location") or {}).get("display_name"))]).lower(),
            seniority=infer_seniority(title, description, tags),
            employment_type=normalize_employment_type(contract_time or contract_type, title, tags),
        )

    def _health_request(self) -> None:
        self.search(SearchParams(query="developer", limit=1))


def adzuna_salary(raw_job: dict[str, Any]) -> str:
    minimum = raw_job.get("salary_min")
    maximum = raw_job.get("salary_max")
    currency = compact(raw_job.get("salary_currency"))
    parts = [str(value) for value in (minimum, maximum) if value not in (None, "", 0)]
    amount = " - ".join(parts)
    return " ".join(part for part in (currency, amount) if part)
