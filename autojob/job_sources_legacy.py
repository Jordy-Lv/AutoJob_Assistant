from __future__ import annotations

# DEPRECATED: Este módulo será eliminado. No agregar lógica nueva aquí.

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from .models import JobOffer


USER_AGENT = (
    "AutoJobAssistant/1.0 "
    "(personal job-search assistant; contact: local-user)"
)
INVALID_JOB_URL_MESSAGE = "No se pudo detectar una oferta laboral válida en esta URL."
MIN_DESCRIPTION_CHARS = 240


class InvalidJobPostingError(ValueError):
    def __init__(self, message: str = INVALID_JOB_URL_MESSAGE) -> None:
        super().__init__(message)


class JobSourceUnavailableError(RuntimeError):
    pass


@dataclass(slots=True)
class SearchResult:
    jobs: list[JobOffer]
    errors: list[str]


def stable_external_id(*parts: str) -> str:
    text = "|".join(part.strip() for part in parts if part and part.strip())
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


def _clean_html(value: str) -> str:
    soup = BeautifulSoup(value or "", "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return re.sub(r"\n{3,}", "\n\n", soup.get_text("\n", strip=True)).strip()


def _validate_url(url: str) -> tuple[str, Any]:
    normalized = (url or "").strip()
    parsed = urlparse(normalized)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("URL inválida. Usa una URL http o https.")
    return normalized, parsed


def _compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _first_text(*values: Any) -> str:
    for value in values:
        text = _compact(value)
        if text:
            return text
    return ""


def _is_login_url(parsed_url: Any) -> bool:
    host = (parsed_url.netloc or "").lower()
    path = (parsed_url.path or "").lower()
    query = (parsed_url.query or "").lower()
    login_markers = ("login", "sign-in", "signin", "auth", "checkpoint", "uas/login")
    if "linkedin." in host and any(marker in f"{path}?{query}" for marker in login_markers):
        return True
    return any(marker in path.strip("/") for marker in ("login", "sign-in", "signin"))


def _is_generic_title(title: str) -> bool:
    normalized = _compact(title).lower().strip(" -|")
    generic_exact = {
        "",
        "jobs",
        "careers",
        "job search",
        "apply",
        "login",
        "sign in",
        "log in",
        "iniciar sesión",
        "trabajos",
        "empleos",
        "oferta importada",
        "just a moment",
        "access denied",
        "attention required",
    }
    if normalized in generic_exact:
        return True
    return any(
        marker in normalized
        for marker in (
            "login",
            "sign in",
            "log in",
            "iniciar sesión",
            "captcha",
            "verify you are human",
            "access denied",
            "just a moment",
            "blocked",
        )
    )


def _page_looks_blocked(title: str, text: str) -> bool:
    sample = f"{title}\n{text[:4000]}".lower()
    blocked_markers = (
        "access denied",
        "attention required",
        "verify you are human",
        "unusual traffic",
        "enable javascript",
        "just a moment",
        "captcha",
        "blocked",
    )
    return any(marker in sample for marker in blocked_markers)


def _page_looks_like_login(parsed_url: Any, title: str, text: str, soup: BeautifulSoup) -> bool:
    sample = f"{title}\n{text[:3000]}".lower()
    host = (parsed_url.netloc or "").lower()
    password_input = soup.find("input", attrs={"type": "password"}) is not None
    login_form = password_input and any(marker in sample for marker in ("sign in", "login", "log in", "password"))
    linkedin_login = "linkedin." in host and any(
        marker in sample
        for marker in (
            "linkedin login",
            "sign in | linkedin",
            "join linkedin",
            "inicia sesión",
            "iniciar sesión",
        )
    )
    return _is_login_url(parsed_url) or login_form or linkedin_login


def _has_job_indicators(text: str) -> bool:
    normalized = text.lower()
    indicators = (
        "responsibilities",
        "requirements",
        "qualifications",
        "experience",
        "apply",
        "employment",
        "full-time",
        "part-time",
        "salary",
        "role",
        "job",
        "benefits",
        "requisitos",
        "responsabilidades",
        "experiencia",
        "aplicar",
        "postular",
        "empleo",
        "cargo",
        "contrato",
        "beneficios",
    )
    return sum(1 for indicator in indicators if indicator in normalized) >= 2


def _jsonld_items(payload: Any) -> Iterable[dict[str, Any]]:
    if isinstance(payload, list):
        for item in payload:
            yield from _jsonld_items(item)
        return

    if not isinstance(payload, dict):
        return

    yield payload
    graph = payload.get("@graph")
    if graph is not None:
        yield from _jsonld_items(graph)


def _type_matches_jobposting(value: Any) -> bool:
    if isinstance(value, list):
        return any(_type_matches_jobposting(item) for item in value)
    return str(value or "").lower().endswith("jobposting")


def _find_jobposting(soup: BeautifulSoup) -> dict[str, Any] | None:
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text("", strip=True)
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue
        for item in _jsonld_items(payload):
            if _type_matches_jobposting(item.get("@type")):
                return item
    return None


def _name_from_value(value: Any) -> str:
    if isinstance(value, list):
        return _first_text(*(_name_from_value(item) for item in value))
    if isinstance(value, dict):
        return _first_text(value.get("name"), value.get("legalName"))
    return _compact(value)


def _country_name(value: Any) -> str:
    if isinstance(value, dict):
        return _first_text(value.get("name"), value.get("addressCountry"))
    return _compact(value)


def _location_from_value(value: Any) -> str:
    if isinstance(value, list):
        locations = [_location_from_value(item) for item in value]
        return ", ".join(dict.fromkeys(location for location in locations if location))
    if not isinstance(value, dict):
        return _compact(value)

    address = value.get("address") if isinstance(value.get("address"), dict) else value
    pieces = [
        _compact(address.get("streetAddress")),
        _compact(address.get("addressLocality")),
        _compact(address.get("addressRegion")),
        _country_name(address.get("addressCountry")),
    ]
    return ", ".join(dict.fromkeys(piece for piece in pieces if piece))


def _salary_from_value(value: Any) -> str:
    if isinstance(value, list):
        return _first_text(*(_salary_from_value(item) for item in value))
    if not isinstance(value, dict):
        return _compact(value)

    currency = _first_text(value.get("currency"), value.get("salaryCurrency"))
    raw_value = value.get("value")
    if isinstance(raw_value, dict):
        min_value = _compact(raw_value.get("minValue"))
        max_value = _compact(raw_value.get("maxValue"))
        unit = _compact(raw_value.get("unitText"))
        amount = " - ".join(part for part in (min_value, max_value) if part)
        if not amount:
            amount = _compact(raw_value.get("value"))
        return " ".join(part for part in (currency, amount, unit) if part)
    return " ".join(part for part in (currency, _compact(raw_value)) if part)


def _list_from_value(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [_compact(item) for item in value if _compact(item)]
    text = _compact(value)
    return [text] if text else []


def _url_from_value(value: Any) -> str:
    if isinstance(value, list):
        return _first_text(*(_url_from_value(item) for item in value))
    return _compact(value)


def _extract_schema_job(item: dict[str, Any], fallback_url: str) -> JobOffer:
    title = _compact(item.get("title"))
    company = _name_from_value(item.get("hiringOrganization"))
    description = _clean_html(str(item.get("description") or ""))
    tags = _list_from_value(item.get("employmentType"))
    if item.get("directApply") is True:
        tags.append("Direct apply")

    _validate_job_quality(title, company, description)
    return JobOffer(
        source="Manual URL",
        external_id=stable_external_id(_url_from_value(item.get("url")) or fallback_url),
        title=title,
        company=company,
        location=_location_from_value(item.get("jobLocation")),
        url=_url_from_value(item.get("url")) or fallback_url,
        description=description[:12000],
        tags=tags,
        salary=_salary_from_value(item.get("baseSalary")),
        published_at=_compact(item.get("datePosted")),
    )


def _meta_content(soup: BeautifulSoup, *names: tuple[str, str]) -> str:
    for attr, value in names:
        tag = soup.find("meta", attrs={attr: value})
        content = tag.get("content") if tag else ""
        if _compact(content):
            return _compact(content)
    return ""


def _text_by_attr_keywords(soup: BeautifulSoup, keywords: tuple[str, ...]) -> str:
    for tag in soup.find_all(True):
        attributes = " ".join(
            " ".join(value) if isinstance(value, list) else str(value)
            for value in (
                tag.get("class", ""),
                tag.get("id", ""),
                tag.get("data-testid", ""),
                tag.get("aria-label", ""),
                tag.get("itemprop", ""),
            )
        ).lower()
        if not any(keyword in attributes for keyword in keywords):
            continue
        text = _compact(tag.get_text(" ", strip=True))
        if 2 <= len(text) <= 140:
            return text
    return ""


def _split_title_company(title: str, company: str) -> tuple[str, str]:
    if company:
        return title, company

    for separator in (" at ", " - ", " | ", " – ", " — "):
        if separator not in title:
            continue
        left, right = title.split(separator, 1)
        left = _compact(left)
        right = _compact(right)
        if left and right and not _is_generic_title(left) and len(right) <= 100:
            return left, right
    return title, company


def _extract_fallback_job(soup: BeautifulSoup, url: str) -> JobOffer:
    title = _first_text(
        _meta_content(soup, ("property", "og:title"), ("name", "twitter:title")),
        soup.find("h1").get_text(" ", strip=True) if soup.find("h1") else "",
        soup.title.string if soup.title else "",
    )
    company = _first_text(
        _meta_content(
            soup,
            ("name", "author"),
            ("property", "og:site_name"),
            ("name", "application-name"),
        ),
        _text_by_attr_keywords(soup, ("company", "employer", "organization", "hiring")),
    )
    title, company = _split_title_company(title, company)
    location = _first_text(
        _meta_content(soup, ("name", "geo.placename")),
        _text_by_attr_keywords(soup, ("location", "address", "ubicacion", "ubicación")),
    )
    description = _clean_html(str(soup))
    _validate_job_quality(title, company, description)
    return JobOffer(
        source="Manual URL",
        external_id=stable_external_id(url),
        title=title,
        company=company,
        location=location,
        url=url,
        description=description[:12000],
        tags=[],
    )


def _validate_job_quality(title: str, company: str, description: str) -> None:
    if _is_generic_title(title):
        raise InvalidJobPostingError()
    if not title or not company:
        raise InvalidJobPostingError()
    if len(_compact(description)) < MIN_DESCRIPTION_CHARS:
        raise InvalidJobPostingError()
    if not _has_job_indicators(description):
        raise InvalidJobPostingError()


def _unique_by_source_id(jobs: Iterable[JobOffer]) -> list[JobOffer]:
    seen: set[tuple[str, str]] = set()
    unique: list[JobOffer] = []
    for job in jobs:
        key = (job.source, job.external_id)
        if key in seen:
            continue
        seen.add(key)
        unique.append(job)
    return unique


def search_remotive(keywords: list[str], limit: int = 40) -> SearchResult:
    jobs: list[JobOffer] = []
    errors: list[str] = []
    terms = [keyword.strip() for keyword in keywords if keyword.strip()]
    if not terms:
        terms = ["software developer"]

    for term in terms:
        try:
            response = requests.get(
                "https://remotive.com/api/remote-jobs",
                params={"search": term, "limit": limit},
                headers={"User-Agent": USER_AGENT},
                timeout=25,
            )
            response.raise_for_status()
            payload = response.json()
        except Exception as exc:  # requests and JSON errors are shown in the UI.
            errors.append(f"Remotive fallo para '{term}': {exc}")
            continue

        for item in payload.get("jobs", []):
            job_id = str(item.get("id") or stable_external_id(item.get("url", ""), term))
            tags = item.get("tags") or []
            if isinstance(tags, str):
                tags = [tags]
            jobs.append(
                JobOffer(
                    source="Remotive",
                    external_id=job_id,
                    title=item.get("title") or "Sin titulo",
                    company=item.get("company_name") or "",
                    location=item.get("candidate_required_location") or "Remote",
                    url=item.get("url") or "",
                    description=_clean_html(item.get("description") or ""),
                    tags=[str(tag) for tag in tags],
                    salary=item.get("salary") or "",
                    published_at=item.get("publication_date") or "",
                )
            )

    return SearchResult(jobs=_unique_by_source_id(jobs)[:limit], errors=errors)


def fetch_job_from_url(url: str, use_browser: bool = False) -> JobOffer:
    normalized_url, parsed_url = _validate_url(url)
    if _is_login_url(parsed_url):
        raise InvalidJobPostingError()

    final_url = normalized_url
    title = ""

    if use_browser:
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page(user_agent=USER_AGENT)
                page.goto(normalized_url, wait_until="domcontentloaded", timeout=30000)
                title = page.title()
                html = page.content()
                final_url = page.url
                browser.close()
        except InvalidJobPostingError:
            raise
        except Exception as exc:
            raise JobSourceUnavailableError(f"La fuente no respondió: {exc}") from exc
    else:
        try:
            response = requests.get(
                normalized_url,
                headers={"User-Agent": USER_AGENT},
                timeout=25,
            )
        except requests.RequestException as exc:
            raise JobSourceUnavailableError(f"La fuente no respondió: {exc}") from exc

        final_url = response.url or normalized_url
        if response.status_code >= 500:
            raise JobSourceUnavailableError("La fuente no respondió")
        if response.status_code >= 400:
            raise InvalidJobPostingError()

        content_type = response.headers.get("content-type", "") if hasattr(response, "headers") else ""
        html = response.text or ""
        if content_type and "html" not in content_type.lower() and "<html" not in html[:300].lower():
            raise InvalidJobPostingError()

    final_parsed_url = urlparse(final_url)
    if _is_login_url(final_parsed_url):
        raise InvalidJobPostingError()

    soup = BeautifulSoup(html, "html.parser")
    text = _clean_html(html)
    title = title or _first_text(
        _meta_content(soup, ("property", "og:title"), ("name", "twitter:title")),
        soup.title.string if soup.title else "",
    )

    if _page_looks_like_login(final_parsed_url, title, text, soup):
        raise InvalidJobPostingError()
    if _page_looks_blocked(title, text):
        raise InvalidJobPostingError()

    schema_job = _find_jobposting(soup)
    if schema_job is not None:
        return _extract_schema_job(schema_job, final_url)

    if not text or len(text) < MIN_DESCRIPTION_CHARS:
        raise InvalidJobPostingError()

    return _extract_fallback_job(soup, final_url)


def build_manual_job(
    title: str,
    company: str,
    location: str,
    url: str,
    description: str,
    tags: str,
    salary: str = "",
) -> JobOffer:
    source = "Manual"
    external_id = stable_external_id(title, company, url, description[:200])
    return JobOffer(
        source=source,
        external_id=external_id,
        title=title.strip() or "Oferta manual",
        company=company.strip(),
        location=location.strip(),
        url=url.strip(),
        description=description.strip(),
        tags=[tag.strip() for tag in re.split(r"[,;\n]", tags) if tag.strip()],
        salary=salary.strip(),
    )


def build_job_from_text(
    raw_text: str,
    url: str = "",
    title: str = "",
    company: str = "",
    location: str = "",
) -> JobOffer:
    """Build a JobOffer from text pasted by the user (assisted LinkedIn capture).

    Heuristic: if title/company/location are not provided, try to extract them
    from the first non-empty lines. Description is the full pasted text.
    No login, no scraping. Source defaults to "LinkedIn (captura asistida)" when
    the URL points to linkedin.com.
    """
    text = (raw_text or "").strip()
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    detected_title = title.strip()
    detected_company = company.strip()
    detected_location = location.strip()

    if not detected_title and lines:
        detected_title = lines[0][:160]
    if not detected_company and len(lines) > 1:
        detected_company = lines[1][:120]
    if not detected_location and len(lines) > 2:
        candidate = lines[2]
        if 2 < len(candidate) <= 120 and not candidate.endswith("."):
            detected_location = candidate

    parsed = urlparse(url) if url else None
    is_linkedin = bool(parsed and "linkedin." in (parsed.netloc or "").lower())
    source = "LinkedIn (captura asistida)" if is_linkedin else "Captura asistida"

    external_id = stable_external_id(detected_title, detected_company, url, text[:200])
    remote = bool(re.search(r"\bremot[oa]\b|\bremote\b|\bworldwide\b", text, re.IGNORECASE))

    return JobOffer(
        source=source,
        external_id=external_id,
        title=detected_title or "Oferta capturada",
        company=detected_company,
        location=detected_location,
        url=url.strip(),
        description=text,
        tags=[],
        salary="",
        remote=remote,
    )
