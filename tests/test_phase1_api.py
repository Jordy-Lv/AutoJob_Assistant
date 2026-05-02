from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
from autojob.config import OUTPUT_DIR, ensure_directories
from autojob.job_sources import INVALID_JOB_URL_MESSAGE, fetch_job_from_url
from autojob.models import JobOffer
from autojob.routers import profile as profile_router


class FakeResponse:
    def __init__(
        self,
        text: str,
        url: str = "https://example.com/jobs/1",
        status_code: int = 200,
        content_type: str = "text/html; charset=utf-8",
    ) -> None:
        self.text = text
        self.url = url
        self.status_code = status_code
        self.headers = {"content-type": content_type}


class Phase1ApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(api.app)

    def test_health(self) -> None:
        with (
            patch.object(api.db, "check_database_health", return_value={"ok": True, "database_url": "postgresql://***", "error": ""}),
            patch.object(profile_router, "has_ai_credentials", return_value=False),
        ):
            response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["database"]["ok"])

    def test_overview(self) -> None:
        with (
            patch.object(api.db, "check_database_health", return_value={"ok": True, "database_url": "postgresql://***", "error": ""}),
            patch.object(api.db, "list_jobs", return_value=[]),
            patch.object(api.db, "list_applications", return_value=[]),
            patch.object(api.db, "list_automation_runs", return_value=[]),
        ):
            response = self.client.get("/api/overview")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_jobs"], 0)

    def test_import_url_rejects_invalid_url(self) -> None:
        with patch.object(api.db, "upsert_job") as upsert_job:
            response = self.client.post("/api/jobs/import-url", json={"url": "not-a-url"})

        self.assertEqual(response.status_code, 400)
        self.assertIn("URL inválida", response.json()["detail"])
        upsert_job.assert_not_called()

    def test_import_url_rejects_login_page(self) -> None:
        login_html = """
        <html>
          <head><title>LinkedIn Login, Sign in | LinkedIn</title></head>
          <body>
            <form><input type="password" /></form>
            Sign in to LinkedIn and join LinkedIn before continuing.
            This page is not a job posting. Please sign in to continue.
            Sign in to LinkedIn and join LinkedIn before continuing.
            This page is not a job posting. Please sign in to continue.
          </body>
        </html>
        """

        with (
            patch("autojob.job_sources.requests.get", return_value=FakeResponse(login_html, url="https://www.linkedin.com/login")),
            patch.object(api.db, "upsert_job") as upsert_job,
        ):
            response = self.client.post(
                "/api/jobs/import-url",
                json={"url": "https://www.linkedin.com/jobs/view/123"},
            )

        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], INVALID_JOB_URL_MESSAGE)
        upsert_job.assert_not_called()

    def test_import_url_extracts_schema_jobposting_before_fallback(self) -> None:
        description = " ".join(
            [
                "Responsibilities include building APIs with Python and FastAPI.",
                "Requirements include PostgreSQL experience and production ownership.",
                "This full-time role offers benefits, remote collaboration, and engineering impact.",
            ]
            * 4
        )
        html = f"""
        <html>
          <head>
            <title>Generic Careers</title>
            <script type="application/ld+json">
            {{
              "@context": "https://schema.org",
              "@type": "JobPosting",
              "title": "Senior Backend Engineer",
              "hiringOrganization": {{"@type": "Organization", "name": "Acme Labs"}},
              "jobLocation": {{"address": {{"addressLocality": "Bogota", "addressCountry": "CO"}}}},
              "description": "{description}",
              "datePosted": "2026-05-01",
              "employmentType": "FULL_TIME",
              "baseSalary": {{"currency": "USD", "value": {{"minValue": 70000, "maxValue": 90000, "unitText": "YEAR"}}}},
              "directApply": true,
              "url": "https://example.com/jobs/backend"
            }}
            </script>
          </head>
          <body><h1>Careers</h1></body>
        </html>
        """

        with patch("autojob.job_sources.requests.get", return_value=FakeResponse(html)):
            job = fetch_job_from_url("https://example.com/jobs/backend")

        self.assertEqual(job.title, "Senior Backend Engineer")
        self.assertEqual(job.company, "Acme Labs")
        self.assertIn("FULL_TIME", job.tags)
        self.assertIn("Direct apply", job.tags)
        self.assertEqual(job.published_at, "2026-05-01")

    def test_document_download_is_served_from_outputs(self) -> None:
        ensure_directories()
        path = OUTPUT_DIR / "phase1-test-download.txt"
        path.write_text("document ok", encoding="utf-8")
        try:
            with patch.object(
                api.db,
                "get_document",
                return_value={"id": 77, "job_id": 1, "doc_type": "TXT", "path": str(path), "created_at": "2026-05-02"},
            ):
                response = self.client.get("/api/documents/77/download")
        finally:
            path.unlink(missing_ok=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "document ok")
        self.assertIn("attachment", response.headers.get("content-disposition", ""))

    def test_document_download_blocks_path_traversal(self) -> None:
        outside_path = Path(tempfile.gettempdir()) / "autojob-outside-document.txt"
        outside_path.write_text("outside", encoding="utf-8")
        try:
            with patch.object(
                api.db,
                "get_document",
                return_value={"id": 88, "job_id": 1, "doc_type": "TXT", "path": str(outside_path), "created_at": "2026-05-02"},
            ):
                response = self.client.get("/api/documents/88/download")
        finally:
            outside_path.unlink(missing_ok=True)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Documento no permitido")


if __name__ == "__main__":
    unittest.main()
