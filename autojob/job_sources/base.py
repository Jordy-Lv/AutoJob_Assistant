from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import os
import re
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from typing import Any

import requests
from bs4 import BeautifulSoup

from autojob.models import JobOffer, SearchParams


USER_AGENT = "AutoJobAssistant/1.0 (responsible public job API client)"
DEFAULT_TIMEOUT_SECONDS = 15
SECRET_PARAM_NAMES = {
    "api_key",
    "app_key",
    "app_id",
    "key",
    "token",
    "access_token",
}


class ProviderError(RuntimeError):
    pass


@dataclass(slots=True)
class SourceHealth:
    id: str
    name: str
    enabled: bool
    configured: bool
    requires_api_key: bool
    status: str
    error: str | None = None


@dataclass(slots=True)
class SearchResult:
    source: str
    external_id: str
    title: str
    company: str
    location: str = ""
    url: str = ""
    description: str = ""
    salary: str = ""
    tags: list[str] = field(default_factory=list)
    published_at: str = ""
    remote: bool = False
    seniority: str = ""
    employment_type: str = ""

    def to_job_offer(self) -> JobOffer:
        return JobOffer(
            source=self.source,
            external_id=self.external_id,
            title=self.title,
            company=self.company,
            location=self.location,
            url=self.url,
            description=self.description,
            salary=self.salary,
            tags=self.tags,
            published_at=self.published_at,
            remote=self.remote,
            seniority=self.seniority,
            employment_type=self.employment_type,
        )


class JobSourceProvider(ABC):
    source_id = "base"
    display_name = "Base"
    enabled = True
    requires_api_key = False
    timeout_seconds = DEFAULT_TIMEOUT_SECONDS
    retries = 1

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
            }
        )

    def is_configured(self) -> bool:
        return True

    def configuration_error(self) -> str | None:
        return None

    def health_check(self) -> SourceHealth:
        configured = self.is_configured()
        if not configured:
            return SourceHealth(
                id=self.source_id,
                name=self.display_name,
                enabled=self.enabled,
                configured=False,
                requires_api_key=self.requires_api_key,
                status="missing_api_key",
                error=self.configuration_error(),
            )
        try:
            self._health_request()
        except Exception as exc:
            return SourceHealth(
                id=self.source_id,
                name=self.display_name,
                enabled=self.enabled,
                configured=True,
                requires_api_key=self.requires_api_key,
                status="unavailable",
                error=str(exc),
            )
        return SourceHealth(
            id=self.source_id,
            name=self.display_name,
            enabled=self.enabled,
            configured=True,
            requires_api_key=self.requires_api_key,
            status="available",
        )

    def source_info(self) -> dict[str, Any]:
        configured = self.is_configured()
        status = "available" if configured else "missing_api_key"
        return {
            "id": self.source_id,
            "name": self.display_name,
            "enabled": self.enabled,
            "configured": configured,
            "requires_api_key": self.requires_api_key,
            "status": status,
            "error": None if configured else self.configuration_error(),
        }

    @abstractmethod
    def search(self, params: SearchParams) -> list[JobOffer]:
        raise NotImplementedError

    @abstractmethod
    def normalize(self, raw_job: dict[str, Any]) -> JobOffer:
        raise NotImplementedError

    def _health_request(self) -> None:
        return None

    def _get_json(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> Any:
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                response = self.session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=self.timeout_seconds,
                )
                if response.status_code >= 500:
                    raise ProviderError(f"{self.display_name} returned HTTP {response.status_code}")
                if response.status_code >= 400:
                    raise ProviderError(self._http_error_message(response))
                return response.json()
            except (requests.RequestException, ValueError, ProviderError) as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(0.4)
        raise ProviderError(safe_error_message(last_error, self.display_name))

    def _http_error_message(self, response: requests.Response) -> str:
        detail = response_error_detail(response)
        if detail:
            return f"{self.display_name} returned HTTP {response.status_code}: {detail}"
        return f"{self.display_name} returned HTTP {response.status_code}"


def response_error_detail(response: requests.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        text = compact(response.text)
        return text[:240]
    if isinstance(payload, dict):
        for key in ("error", "message", "detail"):
            value = compact(payload.get(key))
            if value:
                return value[:240]
    return compact(str(payload))[:240]


def safe_error_message(error: Exception | None, provider_name: str) -> str:
    if error is None:
        return f"{provider_name} failed"
    return redact_secret_query_values(str(error))


def redact_secret_query_values(value: str) -> str:
    for secret in SECRET_PARAM_NAMES:
        value = re.sub(rf"({secret}=)[^&\s]+", rf"\1***", value, flags=re.IGNORECASE)
    return value


def safe_url(value: str) -> str:
    parsed = urlsplit(value)
    query = urlencode(
        [
            (key, "***" if key.lower() in SECRET_PARAM_NAMES else val)
            for key, val in parse_qsl(parsed.query, keep_blank_values=True)
        ]
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def env_is_set(*names: str) -> bool:
    return all(bool(os.getenv(name, "").strip()) for name in names)


def missing_env_message(*names: str) -> str:
    return "Missing " + " or ".join(names)


def stable_external_id(*parts: str) -> str:
    text = "|".join(part.strip() for part in parts if part and part.strip())
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def clean_html(value: str) -> str:
    soup = BeautifulSoup(value or "", "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return re.sub(r"\n{3,}", "\n\n", soup.get_text("\n", strip=True)).strip()


def compact(value: Any) -> str:
    return " ".join(str(value or "").split())


def string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [compact(item) for item in value if compact(item)]
    text = compact(value)
    return [text] if text else []


def dedupe_text(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        normalized = value.strip()
        key = normalized.lower()
        if not normalized or key in seen:
            continue
        seen.add(key)
        result.append(normalized)
    return result


def timestamp_to_iso(value: Any) -> str:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return ""
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(timespec="seconds")


def infer_seniority(title: str, description: str = "", tags: list[str] | None = None) -> str:
    sample = " ".join([title, description[:1000], " ".join(tags or [])]).lower()
    if any(marker in sample for marker in ("internship", "intern ", "trainee", "apprentice", "practicante")):
        return "internship"
    if any(marker in sample for marker in ("junior", "entry level", "entry-level", "graduate", "jr.")):
        return "junior"
    if any(marker in sample for marker in ("senior", "sr.", "lead", "principal", "staff", "architect")):
        return "senior"
    return "mid"


def normalize_employment_type(raw_type: str, title: str, tags: list[str] | None = None) -> str:
    sample = " ".join([raw_type, title, " ".join(tags or [])]).lower()
    if any(marker in sample for marker in ("internship", "intern ", "practicante")):
        return "internship"
    if any(marker in sample for marker in ("part_time", "part-time", "part time", "teilzeit")):
        return "part_time"
    if any(marker in sample for marker in ("contract", "contractor", "freelance")):
        return "contract"
    if any(marker in sample for marker in ("full_time", "full-time", "full time", "permanent")):
        return "full_time"
    return raw_type or ""
