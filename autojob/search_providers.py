from __future__ import annotations

# DEPRECATED: Este shim será eliminado. Importar providers desde autojob.job_sources.

# Backward-compatible imports. New providers live in autojob.job_sources.
from autojob.job_sources.adzuna import AdzunaProvider
from autojob.job_sources.arbeitnow import ArbeitnowProvider
from autojob.job_sources.base import (
    JobSourceProvider,
    ProviderError,
    SourceHealth as ProviderHealth,
    clean_html as _clean_html,
    compact as _compact,
    dedupe_text as _dedupe_text,
    infer_seniority,
    normalize_employment_type,
    stable_external_id,
)
from autojob.job_sources.registry import all_providers as default_providers
from autojob.job_sources.remoteok import RemoteOKProvider
from autojob.job_sources.remotive import RemotiveProvider
from autojob.job_sources.serpapi import SerpAPIProvider

__all__ = [
    "AdzunaProvider",
    "ArbeitnowProvider",
    "JobSourceProvider",
    "ProviderError",
    "ProviderHealth",
    "RemoteOKProvider",
    "RemotiveProvider",
    "SerpAPIProvider",
    "default_providers",
    "infer_seniority",
    "normalize_employment_type",
    "stable_external_id",
]
