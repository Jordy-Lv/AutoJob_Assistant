from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import html
import os
import re
from typing import Any
from urllib.parse import urlparse
import unicodedata

import requests

from autojob.models import JobOffer, SearchParams

from .base import (
    JobSourceProvider,
    USER_AGENT,
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

# Max pages to fetch per search (each page ≈ 10 results from Google Jobs).
SERPAPI_MAX_PAGES = int(os.getenv("SERPAPI_MAX_PAGES", "5"))
# Set to "true" to bypass SerpAPI cache — uses more credits but guarantees fresh results.
SERPAPI_NO_CACHE = os.getenv("SERPAPI_NO_CACHE", "").lower() in ("1", "true", "yes")

# Map our date_filter values to the label text we look for in SerpAPI's
# "Date posted" filter options.  Multiple synonyms handle API wording changes.
_DATE_FILTER_LABELS: dict[str, list[str]] = {
    "24h": ["today", "yesterday", "last 24"],
    "1d":  ["today", "yesterday", "last 24"],
    "2d":  ["last 3 days", "past 3 days", "3 days"],
    "3d":  ["last 3 days", "past 3 days", "3 days"],
    "4d":  ["past week", "last week", "week"],
    "7d":  ["past week", "last week", "week"],
    "week": ["past week", "last week", "week"],
    "14d": ["past month", "last month", "month"],
    "30d": ["past month", "last month", "month"],
    "month": ["past month", "last month", "month"],
}

# Legacy chips fallback — still accepted by SerpAPI even though Google
# considers the parameter deprecated.  Used when the probe request returns
# no recognisable "Date posted" filter options.
#
# NOTE: For tight filters (24h/1d/2d) we deliberately use a BROADER
# server-side window (3days) so Google Jobs returns something.  The local
# matches_date_filter() call in search_engine.py applies the exact cutoff.
_DATE_CHIPS: dict[str, str] = {
    "24h":   "date_posted:3days",
    "1d":    "date_posted:3days",
    "2d":    "date_posted:3days",
    "3d":    "date_posted:3days",
    "4d":    "date_posted:week",
    "7d":    "date_posted:week",
    "week":  "date_posted:week",
    "14d":   "date_posted:month",
    "30d":   "date_posted:month",
    "month": "date_posted:month",
}

_NO_RESULTS_ERROR_MARKERS = (
    "google hasn't returned any results",
    "google has not returned any results",
    "no results for this query",
)


class SerpAPIProvider(JobSourceProvider):
    source_id = "serpapi"
    display_name = "SerpAPI Google Jobs"
    description = "Google Jobs indexado via SerpAPI. Requiere cuenta en serpapi.com"
    env_vars = ["SERPAPI_KEY"]
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
        date_filter = (params.date_filter or "").strip().lower()
        apply_date = date_filter and date_filter not in ("any", "all")

        # Over-fetch so that local date filtering still yields enough results.
        fetch_limit = min(max(params.limit * 2, 20), SERPAPI_MAX_PAGES * 10)

        base_params: dict[str, Any] = {
            "engine": "google_jobs",
            "q": query,
            "location": location,
            "api_key": os.getenv("SERPAPI_KEY", ""),
        }
        if SERPAPI_NO_CACHE:
            base_params["no_cache"] = "true"

        req_params = dict(base_params)

        if apply_date:
            # Probe: one unfiltered request to obtain the live "Date posted"
            # filter tokens (uds) that Google embeds in the response.
            try:
                probe = self._safe_request(base_params, allow_probe_error=True)
            except Exception:
                probe = {}
            uds, q_update = _extract_date_uds(probe, _DATE_FILTER_LABELS.get(date_filter, []))
            if uds:
                req_params["uds"] = uds
                if q_update:
                    req_params["q"] = q_update
            else:
                # Fall back to the legacy chips parameter.
                chips = _DATE_CHIPS.get(date_filter)
                if chips:
                    req_params["chips"] = chips

        all_items: list[dict[str, Any]] = []
        next_page_token: str | None = None

        for _ in range(SERPAPI_MAX_PAGES):
            page_params = dict(req_params)
            if next_page_token:
                page_params["next_page_token"] = next_page_token

            payload = self._safe_request(page_params)
            items = payload.get("jobs_results", [])
            all_items.extend(item for item in items if isinstance(item, dict))

            pagination = payload.get("serpapi_pagination") or {}
            next_page_token = pagination.get("next_page_token") if isinstance(pagination, dict) else None

            if not next_page_token or len(all_items) >= fetch_limit:
                break

        return [self.normalize(item) for item in all_items[:fetch_limit] if isinstance(item, dict)]

    def _safe_request(self, params: dict[str, Any], *, allow_probe_error: bool = False) -> dict[str, Any]:
        payload = self._get_json(self.endpoint, params)
        if not isinstance(payload, dict):
            return {}
        if payload.get("error"):
            error = compact(payload["error"])
            if _is_no_results_error(error):
                return {}
            if allow_probe_error:
                return {}
            raise RuntimeError(error)
        return payload

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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_date_uds(
    payload: dict[str, Any],
    labels: list[str],
) -> tuple[str | None, str | None]:
    """Search the SerpAPI filters array for a Date-posted option matching any
    of the given label substrings.  Returns (uds, q_update) or (None, None)."""
    filters = payload.get("filters")
    if not isinstance(filters, list):
        return None, None
    labels_lower = [l.lower() for l in labels]
    for group in filters:
        if not isinstance(group, dict):
            continue
        group_type = str(group.get("type", "") or group.get("name", "")).lower()
        if "date" not in group_type and "posted" not in group_type:
            continue
        for option in (group.get("options") or []):
            if not isinstance(option, dict):
                continue
            text = str(option.get("text") or option.get("name") or "").lower()
            if any(lbl in text or text in lbl for lbl in labels_lower):
                uds = option.get("uds") or None
                q_update = option.get("q") or None
                return uds, q_update
    return None, None


def _is_no_results_error(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in _NO_RESULTS_ERROR_MARKERS)


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


class SerpAPILinkedInProvider(SerpAPIProvider):
    source_id = "serpapi_linkedin"
    display_name = "LinkedIn via SerpAPI"

    def search(self, params: SearchParams) -> list[JobOffer]:
        self.last_expired_count = 0
        limit = max(min(int(params.limit or 25), 50), 1)
        candidate_limit = min(limit * 3, 100)
        page_size = 10
        max_requests = max(min(int(os.getenv("SERPAPI_LINKEDIN_MAX_REQUESTS", "10") or 10), 10), 1)
        pages_per_query = max(min(int(os.getenv("SERPAPI_LINKEDIN_PAGES_PER_QUERY", "2") or 2), 5), 1)
        date_tbs = google_date_tbs(params.date_filter)
        jobs: list[JobOffer] = []
        seen_urls: set[str] = set()
        requests_used = 0

        for query in linkedin_queries(params):
            start = 0
            pages_for_query = 0
            while requests_used < max_requests and pages_for_query < pages_per_query and len(jobs) < candidate_limit:
                request_params: dict[str, Any] = {
                    "engine": "google",
                    "q": query,
                    "num": page_size,
                    "start": start,
                    "api_key": os.getenv("SERPAPI_KEY", ""),
                }
                if date_tbs:
                    request_params["tbs"] = date_tbs

                payload = self._get_json(self.endpoint, request_params)
                requests_used += 1
                pages_for_query += 1
                if isinstance(payload, dict) and payload.get("error"):
                    if "hasn't returned any results" not in str(payload.get("error")):
                        raise RuntimeError(str(payload.get("error")))
                    break

                items = payload.get("organic_results", []) if isinstance(payload, dict) else []
                linkedin_items = [
                    item
                    for item in items
                    if isinstance(item, dict) and is_linkedin_job_url(compact(item.get("link")))
                ]
                candidate_items: list[dict[str, Any]] = []
                for item in linkedin_items:
                    url = compact(item.get("link"))
                    if url.lower() in seen_urls:
                        continue
                    seen_urls.add(url.lower())
                    candidate_items.append(item)

                for item in self.open_linkedin_items(candidate_items):
                    job = self.normalize(item)
                    job.location = linkedin_location(item, params)
                    if params.remote_only:
                        job.remote = True
                    jobs.append(job)
                    if len(jobs) >= candidate_limit:
                        break

                if len(items) < page_size:
                    break
                start += page_size

            if requests_used >= max_requests or len(jobs) >= candidate_limit:
                break

        return jobs

    def open_linkedin_items(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        candidates: list[dict[str, Any]] = []
        for item in items:
            if has_closed_linkedin_application_signal(item):
                self.last_expired_count += 1
                continue
            candidates.append(item)

        if not candidates or not linkedin_apply_status_verification_enabled():
            return candidates

        workers = max(min(int(os.getenv("SERPAPI_LINKEDIN_VERIFY_WORKERS", "5") or 5), 10), 1)
        with ThreadPoolExecutor(max_workers=workers) as executor:
            closed_flags = list(
                executor.map(
                    lambda item: linkedin_job_is_closed_for_applications(compact(item.get("link"))),
                    candidates,
                )
            )

        open_items: list[dict[str, Any]] = []
        for item, is_closed in zip(candidates, closed_flags, strict=False):
            if is_closed:
                self.last_expired_count += 1
                continue
            open_items.append(item)
        return open_items

    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        title = compact(raw_job.get("title")) or "LinkedIn job"
        link = compact(raw_job.get("link"))
        description = compact(raw_job.get("snippet"))
        role, company = split_linkedin_title(title)
        return JobOffer(
            source=self.display_name,
            external_id=linkedin_external_id(link) or stable_external_id(link, title),
            title=role,
            company=company,
            location="",
            url=link,
            description=description,
            tags=dedupe_text(["LinkedIn", "SerpAPI"]),
            published_at=compact(raw_job.get("date")),
            remote="remote" in " ".join([title, description]).lower(),
            seniority=infer_seniority(title, description, ["LinkedIn"]),
            employment_type=normalize_employment_type("", title, ["LinkedIn"]),
        )

    def _health_request(self) -> None:
        self.search(SearchParams(query="java developer remote", limit=1))


def serpapi_location(location: str) -> str:
    cleaned = compact(location)
    if cleaned.lower() in {"", "remote", "remoto", "anywhere", "worldwide"}:
        return os.getenv("SERPAPI_LOCATION", "United States").strip() or "United States"
    return cleaned


def linkedin_queries(params: SearchParams) -> list[str]:
    terms = compact(params.query)
    expanded_terms = linkedin_expand_role_terms(terms)
    remote_term = "remote" if params.remote_only and "remote" not in terms.lower() else ""
    location = compact(params.location)
    scoped_location = "" if location.lower() in {"", "remote", "remoto", "anywhere", "worldwide"} else location
    variants = [
        " ".join(part for part in [terms, remote_term, scoped_location] if part),
        " ".join(part for part in [expanded_terms, remote_term, scoped_location] if part),
        " ".join(part for part in [terms, scoped_location] if part),
        " ".join(part for part in [terms, remote_term] if part),
        expanded_terms,
        terms,
    ]
    return [f"site:linkedin.com/jobs/view {variant}" for variant in dedupe_text(variants) if variant]


def linkedin_expand_role_terms(query: str) -> str:
    lowered = query.lower()
    if any(word in lowered for word in ("developer", "engineer", "analyst", "scientist", "devops", "qa")):
        return query
    return f"{query} developer"


def google_date_tbs(date_filter: str) -> str:
    return {
        "24h": "qdr:d",
        "1d": "qdr:d",
        "day": "qdr:d",
        "7d": "qdr:w",
        "week": "qdr:w",
        "30d": "qdr:m",
        "month": "qdr:m",
    }.get((date_filter or "").strip().lower(), "")


def linkedin_location(raw_job: dict[str, Any], params: SearchParams) -> str:
    title = compact(raw_job.get("title"))
    snippet = compact(raw_job.get("snippet"))
    detected = extract_linkedin_location(f"{title}. {snippet}")
    if detected:
        return detected
    requested = compact(params.location)
    if params.remote_only and requested and requested.lower() not in {"remote", "remoto", "anywhere", "worldwide"}:
        return f"Remote / {requested}"
    if params.remote_only:
        return "Remote"
    return requested


def extract_linkedin_location(text: str) -> str:
    match = re.search(r"\bin\s+([A-Z][A-Za-z .,&-]{2,60})(?:\s+\||\.|,|\s+\d+\s+days?\s+ago|$)", text)
    if not match:
        return ""
    value = compact(match.group(1)).strip(" .,-")
    stop_words = {"United", "Latin", "Remote"}
    return value if value and value not in stop_words else ""


def is_linkedin_job_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    path = (parsed.path or "").lower()
    return host.endswith("linkedin.com") and "/jobs/view/" in path


def linkedin_apply_status_verification_enabled() -> bool:
    return os.getenv("SERPAPI_LINKEDIN_VERIFY_APPLY_STATUS", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def linkedin_job_is_closed_for_applications(url: str) -> bool:
    if not is_linkedin_job_url(url):
        return False
    for status_url in linkedin_status_urls(url):
        html_text = fetch_linkedin_status_html(status_url)
        if not html_text:
            continue
        if has_closed_linkedin_application_signal(html_text):
            return True
        if linkedin_apply_cta_is_empty(html_text):
            return True
    return False


def linkedin_status_urls(url: str) -> list[str]:
    job_id = linkedin_external_id(url)
    urls = [url]
    if job_id:
        urls.append(f"https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{job_id}")
    return dedupe_text(urls)


def fetch_linkedin_status_html(url: str) -> str:
    try:
        response = requests.get(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "es,en;q=0.8",
            },
            timeout=linkedin_apply_status_timeout(),
        )
    except requests.RequestException:
        return ""
    if response.status_code >= 400:
        return ""
    return response.text or ""


def linkedin_apply_status_timeout() -> float:
    try:
        return max(min(float(os.getenv("SERPAPI_LINKEDIN_PAGE_TIMEOUT", "6") or 6), 20.0), 1.0)
    except ValueError:
        return 6.0


def has_closed_linkedin_application_signal(value: Any) -> bool:
    sample = normalize_status_text(" ".join(iter_text_values(value)))
    if not sample:
        return False
    return any(normalize_status_text(phrase) in sample for phrase in LINKEDIN_CLOSED_APPLICATION_PHRASES)


def linkedin_apply_cta_is_empty(html_text: str) -> bool:
    match = re.search(
        r'<[^>]*class="[^"]*\btop-card-layout__cta-container\b[^"]*"[^>]*>(.*?)</div>',
        html_text or "",
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return False
    cta_html = match.group(1)
    return not linkedin_apply_cta_has_apply_action(cta_html)


def linkedin_apply_cta_has_apply_action(html_text: str) -> bool:
    sample = normalize_status_text(html_text)
    return any(
        marker in sample
        for marker in (
            "apply-button",
            "public_jobs_apply-link",
            "solicitar",
            "postular",
            "apply now",
            "easy apply",
        )
    )


LINKEDIN_CLOSED_APPLICATION_PHRASES = (
    "Ya no se aceptan solicitudes",
    "Ya no acepta solicitudes",
    "No se aceptan mas solicitudes",
    "No se aceptan solicitudes",
    "Solicitudes cerradas",
    "Esta oferta ya no acepta solicitudes",
    "Esta oferta ya no esta disponible",
    "La oferta ya no esta disponible",
    "No longer accepting applications",
    "This job is no longer accepting applications",
    "Applications are no longer accepted",
    "Applications closed",
    "Application closed",
    "This job has expired",
    "Job has expired",
    "This job is no longer available",
    "This job posting is no longer available",
)


def iter_text_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        parts: list[str] = []
        for nested in value.values():
            parts.extend(iter_text_values(nested))
        return parts
    if isinstance(value, (list, tuple, set)):
        parts = []
        for nested in value:
            parts.extend(iter_text_values(nested))
        return parts
    return [compact(value)]


def normalize_status_text(value: str) -> str:
    decoded = html.unescape(value or "")
    decoded = re.sub(
        r"\\u([0-9a-fA-F]{4})",
        lambda match: chr(int(match.group(1), 16)),
        decoded,
    )
    without_accents = "".join(
        char
        for char in unicodedata.normalize("NFKD", decoded)
        if not unicodedata.combining(char)
    )
    return re.sub(r"\s+", " ", without_accents.lower()).strip()


def linkedin_external_id(url: str) -> str:
    path = urlparse(url).path.strip("/")
    if not path:
        return ""
    slug = path.split("/")[-1]
    match = re.search(r"(\d{6,})(?:\D*)$", slug)
    return match.group(1) if match else slug


def split_linkedin_title(title: str) -> tuple[str, str]:
    cleaned = compact(title)
    if " hiring " in cleaned.lower():
        before, after = split_case_insensitive(cleaned, " hiring ")
        return compact(after) or cleaned, compact(before)
    if " at " in cleaned.lower():
        before, after = split_case_insensitive(cleaned, " at ")
        return compact(before) or cleaned, compact(after)
    if " - " in cleaned:
        role, company = cleaned.rsplit(" - ", 1)
        return compact(role) or cleaned, compact(company)
    return cleaned, ""


def split_case_insensitive(value: str, separator: str) -> tuple[str, str]:
    index = value.lower().find(separator.lower())
    if index < 0:
        return value, ""
    return value[:index], value[index + len(separator):]
