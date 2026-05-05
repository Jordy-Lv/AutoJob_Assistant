from __future__ import annotations

import warnings

# The legacy module emits a DeprecationWarning on import to discourage external
# direct use. This package intentionally re-exports the legacy helpers as a
# backward-compatibility shim, so suppress the warning at this single import
# site rather than letting it bubble up to library consumers.
with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
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
