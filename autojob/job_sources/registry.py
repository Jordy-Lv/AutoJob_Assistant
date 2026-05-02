from __future__ import annotations

from dataclasses import asdict
from typing import Iterable

from .adzuna import AdzunaProvider
from .arbeitnow import ArbeitnowProvider
from .base import JobSourceProvider
from .remoteok import RemoteOKProvider
from .remotive import RemotiveProvider
from .serpapi import SerpAPIProvider


def all_providers() -> list[JobSourceProvider]:
    return [
        RemotiveProvider(),
        ArbeitnowProvider(),
        RemoteOKProvider(),
        AdzunaProvider(),
        SerpAPIProvider(),
    ]


def provider_map() -> dict[str, JobSourceProvider]:
    return {provider.source_id: provider for provider in all_providers()}


def list_sources() -> list[dict]:
    return [provider.source_info() for provider in all_providers()]


def health_checks() -> list[dict]:
    return [asdict(provider.health_check()) for provider in all_providers()]


def select_providers(selected_sources: Iterable[str] | None = None) -> tuple[list[JobSourceProvider], list[dict]]:
    providers = provider_map()
    requested = [source.strip().lower() for source in (selected_sources or []) if source.strip()]
    if not requested:
        requested = [provider.source_id for provider in providers.values() if provider.enabled]

    selected: list[JobSourceProvider] = []
    skipped: list[dict] = []
    for source_id in requested:
        provider = providers.get(source_id)
        if provider is None:
            skipped.append(
                {
                    "id": source_id,
                    "name": source_id,
                    "status": "unknown_source",
                    "found": 0,
                    "saved": 0,
                    "duplicates": 0,
                    "error": "Unknown source",
                }
            )
            continue
        if not provider.enabled:
            skipped.append(source_summary(provider, "disabled", "Source disabled"))
            continue
        if not provider.is_configured():
            skipped.append(source_summary(provider, "not_configured", provider.configuration_error()))
            continue
        selected.append(provider)
    return selected, skipped


def source_summary(
    provider: JobSourceProvider,
    status: str = "pending",
    error: str | None = None,
    found: int = 0,
    saved: int = 0,
    duplicates: int = 0,
) -> dict:
    return {
        "id": provider.source_id,
        "name": provider.display_name,
        "status": status,
        "found": found,
        "saved": saved,
        "duplicates": duplicates,
        "error": error,
    }
