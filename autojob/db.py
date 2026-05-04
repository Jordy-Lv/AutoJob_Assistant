from __future__ import annotations

from functools import lru_cache
import re
from typing import Any, Iterable
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import (
    Boolean,
    Column,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    and_,
    func,
    literal_column,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.engine import Connection
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.engine import Engine, RowMapping
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy import create_engine

from .config import database_url, ensure_directories
from .models import (
    ApplicationRecord,
    AutomationRun,
    JobOffer,
    NotificationRecord,
    SavedSearch,
    SearchParams,
    SearchRun,
    UserProfile,
    utc_now_iso,
)


metadata = MetaData()

profile_table = Table(
    "profile",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("full_name", Text, nullable=False, server_default=""),
    Column("target_role", Text, nullable=False, server_default=""),
    Column("summary", Text, nullable=False, server_default=""),
    Column("skills", Text, nullable=False, server_default=""),
    Column("experience", Text, nullable=False, server_default=""),
    Column("education", Text, nullable=False, server_default=""),
    Column("projects", Text, nullable=False, server_default=""),
    Column("links", Text, nullable=False, server_default=""),
    Column("keywords", Text, nullable=False, server_default=""),
    Column("updated_at", String(40), nullable=False),
)

jobs_table = Table(
    "jobs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("source", Text, nullable=False),
    Column("external_id", Text, nullable=False),
    Column("title", Text, nullable=False),
    Column("company", Text, nullable=False, server_default=""),
    Column("location", Text, nullable=False, server_default=""),
    Column("url", Text, nullable=False, server_default=""),
    Column("description", Text, nullable=False, server_default=""),
    Column("tags", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("salary", Text, nullable=False, server_default=""),
    Column("published_at", Text, nullable=False, server_default=""),
    Column("remote", Boolean, nullable=False, server_default=text("false")),
    Column("seniority", Text, nullable=False, server_default=""),
    Column("employment_type", Text, nullable=False, server_default=""),
    Column("normalized_url", Text, nullable=False, server_default=""),
    Column("job_fingerprint", Text, nullable=False, server_default=""),
    Column("status", Text, nullable=False, server_default="Nueva"),
    Column("score", Float),
    Column("reasons", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("gaps", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("matched_skills", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("priority", Integer, nullable=False, server_default="0"),
    Column("ai_provider", Text, nullable=False, server_default=""),
    Column("ai_summary", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("first_seen_at", String(40), nullable=False),
    Column("last_seen_at", String(40), nullable=False),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
Index("idx_jobs_source_external_id", jobs_table.c.source, jobs_table.c.external_id, unique=True)
Index("idx_jobs_status", jobs_table.c.status)
Index("idx_jobs_score", jobs_table.c.score)
Index("idx_jobs_normalized_url", jobs_table.c.normalized_url)
Index("idx_jobs_fingerprint", jobs_table.c.job_fingerprint)

documents_table = Table(
    "documents",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("job_id", Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    Column("doc_type", Text, nullable=False),
    Column("path", Text, nullable=False),
    Column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", String(40), nullable=False),
)
Index("idx_documents_job_id", documents_table.c.job_id)

automation_runs_table = Table(
    "automation_runs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("run_type", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("summary", Text, nullable=False, server_default=""),
    Column("log", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("started_at", String(40), nullable=False),
    Column("finished_at", String(40)),
)
Index("idx_automation_runs_started_at", automation_runs_table.c.started_at)

applications_table = Table(
    "applications",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("job_id", Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    Column("status", Text, nullable=False),
    Column("portal", Text, nullable=False, server_default=""),
    Column("url", Text, nullable=False, server_default=""),
    Column("documents_used", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("log", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("screenshot_path", Text, nullable=False, server_default=""),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
Index("idx_applications_job_id", applications_table.c.job_id)
Index("idx_applications_status", applications_table.c.status)

source_configs_table = Table(
    "source_configs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False, unique=True),
    Column("enabled", Integer, nullable=False, server_default="1"),
    Column("config", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("updated_at", String(40), nullable=False),
)

search_runs_table = Table(
    "search_runs",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("query", Text, nullable=False),
    Column("filters", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("selected_sources", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("total_found", Integer, nullable=False, server_default="0"),
    Column("total_saved", Integer, nullable=False, server_default="0"),
    Column("duplicates", Integer, nullable=False, server_default="0"),
    Column("errors", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("sources", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("status", Text, nullable=False),
    Column("started_at", String(40), nullable=False),
    Column("finished_at", String(40)),
)
Index("idx_search_runs_started_at", search_runs_table.c.started_at)
Index("idx_search_runs_status", search_runs_table.c.status)

saved_searches_table = Table(
    "saved_searches",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("query", Text, nullable=False),
    Column("location", Text, nullable=False, server_default=""),
    Column("remote_only", Boolean, nullable=False, server_default=text("false")),
    Column("junior_only", Boolean, nullable=False, server_default=text("false")),
    Column("internship_allowed", Boolean, nullable=False, server_default=text("false")),
    Column("selected_sources", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("date_filter", Text, nullable=False, server_default=""),
    Column("score_threshold", Float, nullable=False, server_default="0"),
    Column("interval_minutes", Integer, nullable=False, server_default="360"),
    Column("enabled", Boolean, nullable=False, server_default=text("true")),
    Column("baseline_done", Boolean, nullable=False, server_default=text("false")),
    Column("last_run_at", String(40)),
    Column("last_run_status", Text, nullable=False, server_default=""),
    Column("created_at", String(40), nullable=False),
    Column("updated_at", String(40), nullable=False),
)
Index("idx_saved_searches_enabled", saved_searches_table.c.enabled)

notifications_table = Table(
    "notifications",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("saved_search_id", Integer, ForeignKey("saved_searches.id", ondelete="CASCADE"), nullable=False),
    Column("job_id", Integer, ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False),
    Column("channel", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("error", Text, nullable=False, server_default=""),
    Column("sent_at", String(40), nullable=False),
)
Index("idx_notifications_saved_search_id", notifications_table.c.saved_search_id)
Index(
    "idx_notifications_unique",
    notifications_table.c.saved_search_id,
    notifications_table.c.job_id,
    notifications_table.c.channel,
    unique=True,
)


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    return create_engine(database_url(), pool_pre_ping=True, future=True)


def init_db() -> None:
    ensure_directories()
    engine = get_engine()
    metadata.create_all(engine)
    _ensure_schema_extensions(engine)


def _ensure_schema_extensions(engine: Engine) -> None:
    statements = [
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS remote BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS seniority TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS employment_type TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS normalized_url TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_fingerprint TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS first_seen_at VARCHAR(40) NOT NULL DEFAULT ''",
        "UPDATE jobs SET first_seen_at = created_at WHERE first_seen_at = ''",
        "CREATE INDEX IF NOT EXISTS idx_jobs_normalized_url ON jobs (normalized_url)",
        "CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs (job_fingerprint)",
        "CREATE INDEX IF NOT EXISTS idx_jobs_first_seen_at ON jobs (first_seen_at)",
        "ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS duplicates INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE search_runs ADD COLUMN IF NOT EXISTS sources JSONB NOT NULL DEFAULT '[]'::jsonb",
    ]
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def check_database_health() -> dict[str, Any]:
    url = database_url()
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "database_url": _safe_url(url), "error": ""}
    except SQLAlchemyError as exc:
        return {"ok": False, "database_url": _safe_url(url), "error": str(exc)}


def _safe_url(url: str) -> str:
    if "@" not in url or "://" not in url:
        return url
    prefix, rest = url.split("://", 1)
    if "@" not in rest:
        return url
    return f"{prefix}://***:***@{rest.split('@', 1)[1]}"


def normalize_job_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""
    try:
        parsed = urlparse(raw)
    except ValueError:
        return raw.lower()
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return raw.lower()

    tracking_prefixes = ("utm_",)
    blocked_params = {
        "fbclid",
        "gclid",
        "msclkid",
        "ref",
        "source",
        "source_id",
        "campaign",
    }
    query = [
        (key, value)
        for key, value in parse_qsl(parsed.query, keep_blank_values=False)
        if not key.lower().startswith(tracking_prefixes) and key.lower() not in blocked_params
    ]
    path = parsed.path.rstrip("/") or "/"
    host = parsed.netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return urlunparse((parsed.scheme.lower(), host, path, "", urlencode(query), "")).lower()


def job_identity_fingerprint(title: str, company: str, location: str) -> str:
    parts = [
        re.sub(r"[^a-z0-9]+", " ", (title or "").lower()).strip(),
        re.sub(r"[^a-z0-9]+", " ", (company or "").lower()).strip(),
        re.sub(r"[^a-z0-9]+", " ", (location or "").lower()).strip(),
    ]
    if not parts[0] or not parts[1]:
        return ""
    return "|".join(parts)


def _clean_list(values: Iterable[Any] | None) -> list[str]:
    if not values:
        return []
    return [str(value) for value in values if str(value).strip()]


def _row_to_job(row: RowMapping) -> JobOffer:
    return JobOffer(
        id=row["id"],
        source=row["source"],
        external_id=row["external_id"],
        title=row["title"],
        company=row["company"] or "",
        location=row["location"] or "",
        url=row["url"] or "",
        description=row["description"] or "",
        tags=_clean_list(row["tags"]),
        salary=row["salary"] or "",
        published_at=row["published_at"] or "",
        remote=bool(row.get("remote", False)),
        seniority=row.get("seniority") or "",
        employment_type=row.get("employment_type") or "",
        status=row["status"] or "Nueva",
        score=row["score"],
        reasons=_clean_list(row["reasons"]),
        gaps=_clean_list(row["gaps"]),
        matched_skills=_clean_list(row["matched_skills"]),
        first_seen_at=row.get("first_seen_at") or row["created_at"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_application(row: RowMapping) -> ApplicationRecord:
    return ApplicationRecord(
        id=row["id"],
        job_id=row["job_id"],
        status=row["status"],
        portal=row["portal"] or "",
        url=row["url"] or "",
        documents_used=_clean_list(row["documents_used"]),
        log=list(row["log"] or []),
        screenshot_path=row["screenshot_path"] or "",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_run(row: RowMapping) -> AutomationRun:
    return AutomationRun(
        id=row["id"],
        run_type=row["run_type"],
        status=row["status"],
        summary=row["summary"] or "",
        log=list(row["log"] or []),
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def get_profile() -> UserProfile:
    with get_engine().connect() as conn:
        row = conn.execute(
            select(profile_table).where(profile_table.c.id == 1)
        ).mappings().first()
    if row is None:
        return UserProfile()
    return UserProfile(
        full_name=row["full_name"],
        target_role=row["target_role"],
        summary=row["summary"],
        skills=row["skills"],
        experience=row["experience"],
        education=row["education"],
        projects=row["projects"],
        links=row["links"],
        keywords=row["keywords"],
        updated_at=row["updated_at"],
    )


def save_profile(profile: UserProfile) -> None:
    now = utc_now_iso()
    values = {
        "id": 1,
        "full_name": profile.full_name,
        "target_role": profile.target_role,
        "summary": profile.summary,
        "skills": profile.skills,
        "experience": profile.experience,
        "education": profile.education,
        "projects": profile.projects,
        "links": profile.links,
        "keywords": profile.keywords,
        "updated_at": now,
    }
    stmt = pg_insert(profile_table).values(values)
    stmt = stmt.on_conflict_do_update(
        index_elements=[profile_table.c.id],
        set_={key: values[key] for key in values if key != "id"},
    )
    with get_engine().begin() as conn:
        conn.execute(stmt)


def upsert_job(job: JobOffer) -> tuple[int, bool]:
    """Insert or update a job offer.

    Returns ``(job_id, was_inserted)`` where ``was_inserted`` is True only when
    the row was created for the first time. Existing offers (matched by
    source+external_id, normalized_url or job_fingerprint) return False.
    """
    now = utc_now_iso()
    normalized_url = normalize_job_url(job.url)
    fingerprint = job_identity_fingerprint(job.title, job.company, job.location)
    values = {
        "source": job.source,
        "external_id": job.external_id,
        "title": job.title,
        "company": job.company,
        "location": job.location,
        "url": job.url,
        "description": job.description,
        "tags": _clean_list(job.tags),
        "salary": job.salary,
        "published_at": job.published_at,
        "remote": bool(job.remote),
        "seniority": job.seniority,
        "employment_type": job.employment_type,
        "normalized_url": normalized_url,
        "job_fingerprint": fingerprint,
        "status": job.status,
        "first_seen_at": now,
        "last_seen_at": now,
        "created_at": now,
        "updated_at": now,
    }
    with get_engine().begin() as conn:
        duplicate_id = _find_duplicate_job_id(conn, job.source, job.external_id, normalized_url, fingerprint)
        if duplicate_id is not None:
            duplicate_status = conn.execute(
                select(jobs_table.c.status).where(jobs_table.c.id == duplicate_id)
            ).scalar_one_or_none()
            if duplicate_status == "Descartada":
                return duplicate_id, False
            conn.execute(
                update(jobs_table)
                .where(jobs_table.c.id == duplicate_id)
                .values(**_job_update_values(values, now))
            )
            return duplicate_id, False

        stmt = pg_insert(jobs_table).values(values)
        update_values = {
            "title": stmt.excluded.title,
            "company": stmt.excluded.company,
            "location": stmt.excluded.location,
            "url": stmt.excluded.url,
            "description": stmt.excluded.description,
            "tags": stmt.excluded.tags,
            "salary": stmt.excluded.salary,
            "published_at": stmt.excluded.published_at,
            "remote": stmt.excluded.remote,
            "seniority": stmt.excluded.seniority,
            "employment_type": stmt.excluded.employment_type,
            "normalized_url": stmt.excluded.normalized_url,
            "job_fingerprint": stmt.excluded.job_fingerprint,
            "last_seen_at": now,
            "updated_at": now,
        }
        # xmax = 0 only for freshly inserted rows; non-zero when ON CONFLICT fired UPDATE.
        stmt = stmt.on_conflict_do_update(
            index_elements=[jobs_table.c.source, jobs_table.c.external_id],
            set_=update_values,
        ).returning(jobs_table.c.id, literal_column("(xmax = 0)").label("inserted"))
        row = conn.execute(stmt).first()
        return int(row[0]), bool(row[1])


def _job_update_values(values: dict[str, Any], now: str) -> dict[str, Any]:
    return {
        "title": values["title"],
        "company": values["company"],
        "location": values["location"],
        "url": values["url"],
        "description": values["description"],
        "tags": values["tags"],
        "salary": values["salary"],
        "published_at": values["published_at"],
        "remote": values["remote"],
        "seniority": values["seniority"],
        "employment_type": values["employment_type"],
        "normalized_url": values["normalized_url"],
        "job_fingerprint": values["job_fingerprint"],
        "last_seen_at": now,
        "updated_at": now,
    }


def _find_duplicate_job_id(
    conn: Connection,
    source: str,
    external_id: str,
    normalized_url: str,
    fingerprint: str,
) -> int | None:
    conditions = [and_(jobs_table.c.source == source, jobs_table.c.external_id == external_id)]
    if normalized_url:
        conditions.append(jobs_table.c.normalized_url == normalized_url)
    if fingerprint:
        conditions.append(jobs_table.c.job_fingerprint == fingerprint)
    row = conn.execute(
        select(jobs_table.c.id)
        .where(or_(*conditions))
        .order_by(jobs_table.c.updated_at.desc())
        .limit(1)
    ).first()
    return int(row[0]) if row else None


def find_duplicate_job_id(job: JobOffer) -> int | None:
    normalized_url = normalize_job_url(job.url)
    fingerprint = job_identity_fingerprint(job.title, job.company, job.location)
    with get_engine().connect() as conn:
        return _find_duplicate_job_id(conn, job.source, job.external_id, normalized_url, fingerprint)


def find_discarded_job_id(job: JobOffer) -> int | None:
    normalized_url = normalize_job_url(job.url)
    fingerprint = job_identity_fingerprint(job.title, job.company, job.location)
    with get_engine().connect() as conn:
        duplicate_id = _find_duplicate_job_id(conn, job.source, job.external_id, normalized_url, fingerprint)
        if duplicate_id is None:
            return None
        status = conn.execute(
            select(jobs_table.c.status).where(jobs_table.c.id == duplicate_id)
        ).scalar_one_or_none()
    return duplicate_id if status == "Descartada" else None


def list_jobs(
    status: str | None = None,
    search: str = "",
    min_score: float | None = None,
    include_discarded: bool = False,
) -> list[JobOffer]:
    conditions = []
    if status and status != "Todos":
        conditions.append(jobs_table.c.status == status)
    elif not include_discarded:
        conditions.append(jobs_table.c.status != "Descartada")
    if search.strip():
        needle = f"%{search.strip()}%"
        conditions.append(
            or_(
                jobs_table.c.title.ilike(needle),
                jobs_table.c.company.ilike(needle),
                jobs_table.c.location.ilike(needle),
                jobs_table.c.description.ilike(needle),
            )
        )
    if min_score is not None:
        conditions.append(and_(jobs_table.c.score.is_not(None), jobs_table.c.score >= min_score))

    stmt = select(jobs_table)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(func.coalesce(jobs_table.c.score, -1).desc(), jobs_table.c.updated_at.desc())
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_job(row) for row in rows]


def get_job(job_id: int) -> JobOffer | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            select(jobs_table).where(jobs_table.c.id == job_id)
        ).mappings().first()
    return _row_to_job(row) if row else None


def update_job_status(job_id: int, status: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            update(jobs_table)
            .where(jobs_table.c.id == job_id)
            .values(status=status, updated_at=utc_now_iso())
        )


def update_job_analysis(
    job_id: int,
    score: float,
    reasons: list[str],
    gaps: list[str],
    matched_skills: list[str],
    ai_provider: str = "",
    ai_summary: dict[str, Any] | None = None,
) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            update(jobs_table)
            .where(jobs_table.c.id == job_id)
            .values(
                score=score,
                reasons=_clean_list(reasons),
                gaps=_clean_list(gaps),
                matched_skills=_clean_list(matched_skills),
                ai_provider=ai_provider,
                ai_summary=ai_summary or {},
                updated_at=utc_now_iso(),
            )
        )


def add_document(job_id: int, doc_type: str, path: str, metadata_: dict[str, Any] | None = None) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            documents_table.insert().values(
                job_id=job_id,
                doc_type=doc_type,
                path=path,
                metadata=metadata_ or {},
                created_at=utc_now_iso(),
            )
        )


def list_documents(job_id: int) -> list[dict[str, Any]]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            select(
                documents_table.c.id,
                documents_table.c.job_id,
                documents_table.c.doc_type,
                documents_table.c.path,
                documents_table.c.metadata,
                documents_table.c.created_at,
            )
            .where(documents_table.c.job_id == job_id)
            .order_by(documents_table.c.created_at.desc())
        ).mappings().all()
    return [dict(row) for row in rows]


def get_document(document_id: int) -> dict[str, Any] | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            select(
                documents_table.c.id,
                documents_table.c.job_id,
                documents_table.c.doc_type,
                documents_table.c.path,
                documents_table.c.metadata,
                documents_table.c.created_at,
            )
            .where(documents_table.c.id == document_id)
        ).mappings().first()
    return dict(row) if row else None


def _search_filters(params: SearchParams) -> dict[str, Any]:
    return {
        "location": params.location,
        "remote_only": params.remote_only,
        "junior_only": params.junior_only,
        "internship_allowed": params.internship_allowed,
        "limit": params.limit,
        "date_filter": params.date_filter,
        "page": params.page,
        "auto_analyze": params.auto_analyze,
    }


def create_search_run(params: SearchParams) -> int:
    stmt = (
        search_runs_table.insert()
        .values(
            query=params.query,
            filters=_search_filters(params),
            selected_sources=_clean_list(params.selected_sources),
            total_found=0,
            total_saved=0,
            duplicates=0,
            errors=[],
            sources=[],
            status="running",
            started_at=utc_now_iso(),
            finished_at=None,
        )
        .returning(search_runs_table.c.id)
    )
    with get_engine().begin() as conn:
        return int(conn.execute(stmt).scalar_one())


def finish_search_run(
    run_id: int,
    status: str,
    total_found: int,
    total_saved: int,
    errors: list[dict[str, Any]] | None = None,
    duplicates: int = 0,
    sources: list[dict[str, Any]] | None = None,
) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            update(search_runs_table)
            .where(search_runs_table.c.id == run_id)
            .values(
                status=status,
                total_found=total_found,
                total_saved=total_saved,
                duplicates=duplicates,
                errors=errors or [],
                sources=sources or [],
                finished_at=utc_now_iso(),
            )
        )


def _row_to_search_run(row: RowMapping) -> SearchRun:
    return SearchRun(
        id=row["id"],
        query=row["query"],
        filters=dict(row["filters"] or {}),
        selected_sources=_clean_list(row["selected_sources"]),
        total_found=row["total_found"] or 0,
        total_saved=row["total_saved"] or 0,
        duplicates=row.get("duplicates", 0) or 0,
        errors=list(row["errors"] or []),
        sources=list(row.get("sources", []) or []),
        status=row["status"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )


def list_search_runs(limit: int = 20) -> list[SearchRun]:
    stmt = (
        select(search_runs_table)
        .order_by(search_runs_table.c.started_at.desc())
        .limit(limit)
    )
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_search_run(row) for row in rows]


def create_automation_run(run_type: str, status: str = "En ejecucion", summary: str = "") -> int:
    stmt = (
        automation_runs_table.insert()
        .values(
            run_type=run_type,
            status=status,
            summary=summary,
            log=[],
            started_at=utc_now_iso(),
            finished_at=None,
        )
        .returning(automation_runs_table.c.id)
    )
    with get_engine().begin() as conn:
        return int(conn.execute(stmt).scalar_one())


def finish_automation_run(
    run_id: int,
    status: str,
    summary: str,
    log: list[dict[str, Any]] | None = None,
) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            update(automation_runs_table)
            .where(automation_runs_table.c.id == run_id)
            .values(
                status=status,
                summary=summary,
                log=log or [],
                finished_at=utc_now_iso(),
            )
        )


def list_automation_runs(limit: int = 10) -> list[AutomationRun]:
    stmt = (
        select(automation_runs_table)
        .order_by(automation_runs_table.c.started_at.desc())
        .limit(limit)
    )
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_run(row) for row in rows]


def create_application(
    job_id: int,
    status: str,
    portal: str = "",
    url: str = "",
    documents_used: list[str] | None = None,
    log: list[dict[str, Any]] | None = None,
    screenshot_path: str = "",
) -> int:
    now = utc_now_iso()
    stmt = (
        applications_table.insert()
        .values(
            job_id=job_id,
            status=status,
            portal=portal,
            url=url,
            documents_used=documents_used or [],
            log=log or [],
            screenshot_path=screenshot_path,
            created_at=now,
            updated_at=now,
        )
        .returning(applications_table.c.id)
    )
    with get_engine().begin() as conn:
        return int(conn.execute(stmt).scalar_one())


def update_application(
    application_id: int,
    status: str,
    log: list[dict[str, Any]] | None = None,
    screenshot_path: str | None = None,
) -> None:
    values: dict[str, Any] = {"status": status, "updated_at": utc_now_iso()}
    if log is not None:
        values["log"] = log
    if screenshot_path is not None:
        values["screenshot_path"] = screenshot_path
    with get_engine().begin() as conn:
        conn.execute(
            update(applications_table)
            .where(applications_table.c.id == application_id)
            .values(**values)
        )


def get_latest_application(job_id: int) -> ApplicationRecord | None:
    stmt = (
        select(applications_table)
        .where(applications_table.c.job_id == job_id)
        .order_by(applications_table.c.created_at.desc())
        .limit(1)
    )
    with get_engine().connect() as conn:
        row = conn.execute(stmt).mappings().first()
    return _row_to_application(row) if row else None


def list_applications(status: str | None = None, limit: int = 100) -> list[ApplicationRecord]:
    stmt = select(applications_table).order_by(applications_table.c.updated_at.desc()).limit(limit)
    if status and status != "Todos":
        stmt = stmt.where(applications_table.c.status == status)
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_application(row) for row in rows]


def list_application_history(job_id: int) -> list[ApplicationRecord]:
    stmt = (
        select(applications_table)
        .where(applications_table.c.job_id == job_id)
        .order_by(applications_table.c.created_at.desc())
    )
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_application(row) for row in rows]


def _row_to_saved_search(row: RowMapping) -> SavedSearch:
    return SavedSearch(
        id=row["id"],
        name=row["name"] or "",
        query=row["query"] or "",
        location=row["location"] or "",
        remote_only=bool(row.get("remote_only", False)),
        junior_only=bool(row.get("junior_only", False)),
        internship_allowed=bool(row.get("internship_allowed", False)),
        selected_sources=_clean_list(row["selected_sources"]),
        date_filter=row["date_filter"] or "",
        score_threshold=float(row["score_threshold"] or 0.0),
        interval_minutes=int(row["interval_minutes"] or 0),
        enabled=bool(row.get("enabled", True)),
        baseline_done=bool(row.get("baseline_done", False)),
        last_run_at=row["last_run_at"],
        last_run_status=row["last_run_status"] or "",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_saved_searches(only_enabled: bool = False) -> list[SavedSearch]:
    stmt = select(saved_searches_table).order_by(saved_searches_table.c.created_at.desc())
    if only_enabled:
        stmt = stmt.where(saved_searches_table.c.enabled.is_(True))
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_saved_search(row) for row in rows]


def get_saved_search(saved_search_id: int) -> SavedSearch | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            select(saved_searches_table).where(saved_searches_table.c.id == saved_search_id)
        ).mappings().first()
    return _row_to_saved_search(row) if row else None


def create_saved_search(search: SavedSearch) -> int:
    now = utc_now_iso()
    stmt = (
        saved_searches_table.insert()
        .values(
            name=search.name.strip() or "Búsqueda guardada",
            query=search.query.strip(),
            location=search.location.strip(),
            remote_only=bool(search.remote_only),
            junior_only=bool(search.junior_only),
            internship_allowed=bool(search.internship_allowed),
            selected_sources=_clean_list(search.selected_sources),
            date_filter=search.date_filter.strip(),
            score_threshold=float(search.score_threshold or 0.0),
            interval_minutes=int(search.interval_minutes or 360),
            enabled=bool(search.enabled),
            baseline_done=False,
            last_run_at=None,
            last_run_status="",
            created_at=now,
            updated_at=now,
        )
        .returning(saved_searches_table.c.id)
    )
    with get_engine().begin() as conn:
        return int(conn.execute(stmt).scalar_one())


def update_saved_search(saved_search_id: int, search: SavedSearch) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            update(saved_searches_table)
            .where(saved_searches_table.c.id == saved_search_id)
            .values(
                name=search.name.strip() or "Búsqueda guardada",
                query=search.query.strip(),
                location=search.location.strip(),
                remote_only=bool(search.remote_only),
                junior_only=bool(search.junior_only),
                internship_allowed=bool(search.internship_allowed),
                selected_sources=_clean_list(search.selected_sources),
                date_filter=search.date_filter.strip(),
                score_threshold=float(search.score_threshold or 0.0),
                interval_minutes=int(search.interval_minutes or 360),
                enabled=bool(search.enabled),
                updated_at=utc_now_iso(),
            )
        )


def delete_saved_search(saved_search_id: int) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            saved_searches_table.delete().where(saved_searches_table.c.id == saved_search_id)
        )


def mark_saved_search_run(
    saved_search_id: int,
    status: str,
    baseline_done: bool | None = None,
) -> None:
    values: dict[str, Any] = {
        "last_run_at": utc_now_iso(),
        "last_run_status": status,
        "updated_at": utc_now_iso(),
    }
    if baseline_done is not None:
        values["baseline_done"] = bool(baseline_done)
    with get_engine().begin() as conn:
        conn.execute(
            update(saved_searches_table)
            .where(saved_searches_table.c.id == saved_search_id)
            .values(**values)
        )


def _row_to_notification(row: RowMapping) -> NotificationRecord:
    return NotificationRecord(
        id=row["id"],
        saved_search_id=row["saved_search_id"],
        job_id=row["job_id"],
        channel=row["channel"],
        status=row["status"],
        error=row["error"] or "",
        sent_at=row["sent_at"],
    )


def notification_exists(saved_search_id: int, job_id: int, channel: str) -> bool:
    with get_engine().connect() as conn:
        row = conn.execute(
            select(notifications_table.c.id)
            .where(
                and_(
                    notifications_table.c.saved_search_id == saved_search_id,
                    notifications_table.c.job_id == job_id,
                    notifications_table.c.channel == channel,
                )
            )
            .limit(1)
        ).first()
    return row is not None


def record_notification(
    saved_search_id: int,
    job_id: int,
    channel: str,
    status: str,
    error: str = "",
) -> int:
    stmt = (
        notifications_table.insert()
        .values(
            saved_search_id=saved_search_id,
            job_id=job_id,
            channel=channel,
            status=status,
            error=error,
            sent_at=utc_now_iso(),
        )
        .returning(notifications_table.c.id)
    )
    with get_engine().begin() as conn:
        return int(conn.execute(stmt).scalar_one())


def list_notifications(saved_search_id: int | None = None, limit: int = 100) -> list[NotificationRecord]:
    stmt = (
        select(notifications_table)
        .order_by(notifications_table.c.sent_at.desc())
        .limit(limit)
    )
    if saved_search_id is not None:
        stmt = stmt.where(notifications_table.c.saved_search_id == saved_search_id)
    with get_engine().connect() as conn:
        rows = conn.execute(stmt).mappings().all()
    return [_row_to_notification(row) for row in rows]
