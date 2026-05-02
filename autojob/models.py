from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


STATUS_OPTIONS = (
    "Nueva",
    "Interesante",
    "Lista para aplicar",
    "Aplicada",
    "Descartada",
)

APPLICATION_STATUS_OPTIONS = (
    "Pendiente",
    "Aplicada",
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def split_items(value: str | None) -> list[str]:
    if not value:
        return []
    separators = [",", ";", "\n", "|"]
    normalized = value
    for separator in separators:
        normalized = normalized.replace(separator, "\n")
    return [item.strip() for item in normalized.splitlines() if item.strip()]


@dataclass(slots=True)
class UserProfile:
    full_name: str = ""
    target_role: str = ""
    summary: str = ""
    skills: str = ""
    experience: str = ""
    education: str = ""
    projects: str = ""
    links: str = ""
    keywords: str = ""
    updated_at: str = field(default_factory=utc_now_iso)

    def skills_list(self) -> list[str]:
        return split_items(self.skills)

    def keywords_list(self) -> list[str]:
        return split_items(self.keywords)


@dataclass(slots=True)
class JobOffer:
    source: str
    external_id: str
    title: str
    company: str
    location: str = ""
    url: str = ""
    description: str = ""
    tags: list[str] = field(default_factory=list)
    salary: str = ""
    published_at: str = ""
    remote: bool = False
    seniority: str = ""
    employment_type: str = ""
    id: int | None = None
    status: str = "Nueva"
    score: float | None = None
    reasons: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    matched_skills: list[str] = field(default_factory=list)
    first_seen_at: str = field(default_factory=utc_now_iso)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @property
    def display_name(self) -> str:
        company = self.company or "Empresa no indicada"
        return f"{self.title} - {company}"


@dataclass(slots=True)
class AnalysisResult:
    score: float
    reasons: list[str]
    gaps: list[str]
    matched_skills: list[str]
    recommendation: str


@dataclass(slots=True)
class GeneratedDocument:
    doc_type: str
    path: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ApplicationRecord:
    job_id: int
    status: str
    id: int | None = None
    portal: str = ""
    url: str = ""
    documents_used: list[str] = field(default_factory=list)
    log: list[dict[str, Any]] = field(default_factory=list)
    screenshot_path: str = ""
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)


@dataclass(slots=True)
class AutomationRun:
    run_type: str
    status: str
    id: int | None = None
    summary: str = ""
    log: list[dict[str, Any]] = field(default_factory=list)
    started_at: str = field(default_factory=utc_now_iso)
    finished_at: str | None = None


@dataclass(slots=True)
class SearchParams:
    query: str
    location: str = ""
    remote_only: bool = False
    junior_only: bool = False
    internship_allowed: bool = False
    limit: int = 25
    selected_sources: list[str] = field(default_factory=list)
    date_filter: str = ""
    page: int = 1
    auto_analyze: bool = False


@dataclass(slots=True)
class SavedSearch:
    name: str
    query: str
    location: str = ""
    remote_only: bool = False
    junior_only: bool = False
    internship_allowed: bool = False
    selected_sources: list[str] = field(default_factory=list)
    date_filter: str = ""
    score_threshold: float = 0.0
    interval_minutes: int = 360
    enabled: bool = True
    baseline_done: bool = False
    last_run_at: str | None = None
    last_run_status: str = ""
    id: int | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)


@dataclass(slots=True)
class NotificationRecord:
    saved_search_id: int
    job_id: int
    channel: str
    status: str
    id: int | None = None
    error: str = ""
    sent_at: str = field(default_factory=utc_now_iso)


@dataclass(slots=True)
class SearchRun:
    query: str
    filters: dict[str, Any]
    selected_sources: list[str]
    total_found: int = 0
    total_saved: int = 0
    duplicates: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)
    sources: list[dict[str, Any]] = field(default_factory=list)
    status: str = "running"
    id: int | None = None
    started_at: str = field(default_factory=utc_now_iso)
    finished_at: str | None = None
