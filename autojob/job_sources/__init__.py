from __future__ import annotations

from autojob.job_sources_legacy import (
    INVALID_JOB_URL_MESSAGE,
    InvalidJobPostingError,
    JobSourceUnavailableError,
    build_job_from_text,
    build_manual_job,
    fetch_job_from_url,
)
from autojob import job_sources_legacy as _legacy

from .base import JobSourceProvider, ProviderError, SearchResult
from .registry import all_providers, health_checks, list_sources, select_providers

requests = _legacy.requests

__all__ = [
    "INVALID_JOB_URL_MESSAGE",
    "InvalidJobPostingError",
    "JobSourceUnavailableError",
    "JobSourceProvider",
    "ProviderError",
    "SearchResult",
    "all_providers",
    "build_job_from_text",
    "build_manual_job",
    "fetch_job_from_url",
    "health_checks",
    "list_sources",
    "requests",
    "select_providers",
]
