from __future__ import annotations

from datetime import datetime, timezone
import os
import re
from typing import Any

from autojob.models import JobOffer, SearchParams

from .base import (
    JobSourceProvider,
    ProviderError,
    compact,
    dedupe_text,
    env_is_set,
    infer_seniority,
    missing_env_message,
    normalize_employment_type,
    stable_external_id,
)

_LINKEDIN_HOST = "linkedin.com"
_SERPAPI_ENDPOINT = "https://serpapi.com/search.json"

# Map date_filter to Google Search tbs (time-based search) parameter.
# LinkedIn results come from Google indexing, so freshness is approximate.
_DATE_TBS: dict[str, str] = {
    "24h":   "qdr:w",
    "1d":    "qdr:w",
    "2d":    "qdr:w",
    "3d":    "qdr:w",
    "4d":    "qdr:w",
    "7d":    "qdr:w",
    "week":  "qdr:w",
    "14d":   "qdr:m",
    "30d":   "qdr:m",
    "month": "qdr:m",
}

# Signals in title or snippet that indicate an expired / closed listing.
_EXPIRED_SIGNALS: frozenset[str] = frozenset([
    "expired",
    "no longer accepting",
    "no longer available",
    "closed",
    "not accepting applications",
    "position has been filled",
    "job closed",
    "listing has expired",
    "this job is no longer",
    "application deadline",
    "posting has expired",
    # Spanish
    "caducada",
    "cerrada",
    "ya no acepta",
    "expirada",
    "oferta caducada",
    "oferta cerrada",
    "oferta no disponible",
    "no disponible",
    "esta oferta ha caducado",
    "oferta expirada",
])


class LinkedInSerpProvider(JobSourceProvider):
    """
    Busca ofertas de LinkedIn usando Google Search + site: operator a través de SerpAPI.
    No requiere cuenta de LinkedIn ni scraping directo. Usa la misma SERPAPI_KEY
    que SerpAPIProvider (Google Jobs), pero con el engine 'google' estándar.

    Limitación conocida: Google indexa por fecha de indexación, no por fecha real de
    publicación de LinkedIn. Los filtros tbs son aproximados. Se aplica detección
    de snippets expirados como defensa adicional.
    """

    source_id = "linkedin"
    display_name = "LinkedIn (via SerpAPI)"
    description = "Ofertas de LinkedIn indexadas por Google. Requiere SERPAPI_KEY."
    env_vars = ["SERPAPI_KEY"]
    requires_api_key = True

    def is_configured(self) -> bool:
        return env_is_set("SERPAPI_KEY")

    def configuration_error(self) -> str | None:
        return None if self.is_configured() else missing_env_message("SERPAPI_KEY")

    def search(self, params: SearchParams) -> list[JobOffer]:
        location = params.location.strip()
        if not location or location.lower() in ("remote", "remoto", "anywhere", "worldwide", ""):
            location_part = "Remote"
        else:
            location_part = location

        q = f'site:{_LINKEDIN_HOST}/jobs/view "{params.query}" "{location_part}"'

        date_filter = (params.date_filter or "").strip().lower()
        tbs = _DATE_TBS.get(date_filter, "qdr:w")  # default: past week

        serpapi_params: dict[str, Any] = {
            "engine": "google",
            "q": q,
            "num": min(max(params.limit, 5), 20),
            "api_key": os.getenv("SERPAPI_KEY", ""),
            "gl": "us",
            "hl": "en",
            "tbs": tbs,
        }

        payload = self._get_json(_SERPAPI_ENDPOINT, serpapi_params)

        if isinstance(payload, dict) and payload.get("error"):
            raise ProviderError(str(payload["error"]))

        organic = payload.get("organic_results", []) if isinstance(payload, dict) else []
        jobs: list[JobOffer] = []
        for item in organic:
            if not isinstance(item, dict):
                continue
            job = self._normalize_result(item, location_part)
            if job is not None:
                jobs.append(job)

        return jobs[: max(params.limit, 1)]

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        job = self._normalize_result(raw_job, "")
        if job is not None:
            return job
        url = compact(raw_job.get("link", ""))
        return JobOffer(
            source="LinkedIn",
            external_id=stable_external_id(url or "linkedin-unknown"),
            title="Untitled role",
            company="",
        )

    def _normalize_result(self, raw: dict[str, Any], search_location: str) -> JobOffer | None:
        url = compact(raw.get("link", ""))

        # Only accept real LinkedIn job listing URLs.
        if _LINKEDIN_HOST not in url or "/jobs/" not in url:
            return None

        raw_title = compact(raw.get("title", ""))
        snippet = compact(raw.get("snippet", ""))

        # Discard results that clearly indicate an expired / closed listing.
        if _is_expired_result(raw_title, snippet):
            return None

        title, company, location_str = _parse_linkedin_title(raw_title)
        if not location_str:
            location_str = search_location

        external_id = stable_external_id(url)
        text_blob = " ".join([title, snippet, location_str]).lower()

        return JobOffer(
            source="LinkedIn",
            external_id=external_id,
            title=title or "Untitled role",
            company=company,
            location=location_str,
            url=url,
            description=snippet,
            salary="",
            tags=dedupe_text(["linkedin"]),
            published_at=compact(raw.get("date")) or datetime.now(timezone.utc).isoformat(timespec="seconds"),
            remote="remote" in text_blob,
            seniority=infer_seniority(title, snippet),
            employment_type=normalize_employment_type("", title),
        )

    def _health_request(self) -> None:
        self.search(SearchParams(query="software developer", location="Remote", limit=1))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _is_expired_result(title: str, snippet: str) -> bool:
    """Return True if the title or snippet signals an expired/closed listing."""
    text = (title + " " + snippet).lower()
    return any(signal in text for signal in _EXPIRED_SIGNALS)


def _parse_linkedin_title(raw_title: str) -> tuple[str, str, str]:
    """
    Parsea títulos de resultados Google para LinkedIn.

    Formatos comunes:
      "Senior Backend Engineer - Acme Corp - Remote | LinkedIn"
      "Java Developer at TechCo - New York | LinkedIn"
      "Backend Engineer - LinkedIn"
    Devuelve (titulo, empresa, ubicacion).
    """
    cleaned = re.sub(r"\s*[|\-–]\s*LinkedIn\s*$", "", raw_title, flags=re.IGNORECASE).strip()

    # "Title at Company - Location"
    at_match = re.match(r"^(.+?)\s+at\s+(.+?)(?:\s+-\s+(.+))?$", cleaned, re.IGNORECASE)
    if at_match:
        return (
            compact(at_match.group(1)),
            compact(at_match.group(2) or ""),
            compact(at_match.group(3) or ""),
        )

    # "Title - Company - Location"
    parts = [p.strip() for p in cleaned.split(" - ")]
    if len(parts) >= 3:
        return parts[0], parts[1], parts[2]
    if len(parts) == 2:
        return parts[0], parts[1], ""
    return cleaned, "", ""
