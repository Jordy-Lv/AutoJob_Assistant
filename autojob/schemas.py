from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ProfilePayload(BaseModel):
    full_name: str = ""
    target_role: str = ""
    summary: str = ""
    skills: str = ""
    experience: str = ""
    education: str = ""
    projects: str = ""
    links: str = ""
    keywords: str = ""


class SearchPayload(BaseModel):
    keywords: str
    limit: int = 25


class JobSearchPayload(BaseModel):
    query: str
    location: str = ""
    remote_only: bool = False
    junior_only: bool = False
    internship_allowed: bool = False
    limit: int = 25
    selected_sources: list[str] = Field(default_factory=list)
    date_filter: str = ""
    page: int = 1
    auto_analyze: bool = False
    save_results: bool = True


class ManualJobPayload(BaseModel):
    title: str
    company: str = ""
    location: str = ""
    url: str = ""
    salary: str = ""
    tags: str = ""
    description: str = ""


class UrlImportPayload(BaseModel):
    url: str
    use_browser: bool = False


class StatusPayload(BaseModel):
    status: str


class AnalyzePayload(BaseModel):
    use_ai: bool = False


class SavedSearchPayload(BaseModel):
    name: str
    query: str
    location: str = ""
    remote_only: bool = False
    junior_only: bool = False
    internship_allowed: bool = False
    selected_sources: list[str] = Field(default_factory=list)
    date_filter: str = ""
    score_threshold: float = 0.0
    interval_minutes: int = 360
    enabled: bool = True

    @field_validator("interval_minutes")
    @classmethod
    def validate_interval(cls, value: int) -> int:
        if value < 15:
            raise ValueError("El intervalo mínimo es 15 minutos.")
        if value > 1440:
            raise ValueError("El intervalo máximo es 1440 minutos (1 día).")
        return value

    @field_validator("score_threshold")
    @classmethod
    def validate_threshold(cls, value: float) -> float:
        if value < 0 or value > 100:
            raise ValueError("El umbral debe estar entre 0 y 100.")
        return value

    @field_validator("query")
    @classmethod
    def validate_query(cls, value: str) -> str:
        if len(value.strip()) < 2:
            raise ValueError("La búsqueda necesita al menos 2 caracteres.")
        return value


class TextImportPayload(BaseModel):
    raw_text: str
    url: str = ""
    title: str = ""
    company: str = ""
    location: str = ""

    @field_validator("raw_text")
    @classmethod
    def validate_raw_text(cls, value: str) -> str:
        if len(value.strip()) < 80:
            raise ValueError("Pega al menos 80 caracteres para detectar la oferta.")
        return value
