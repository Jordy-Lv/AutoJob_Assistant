from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
from autojob.models import JobOffer, SearchParams
from autojob.search_engine import dedupe_jobs, parse_date, run_job_search
from autojob.job_sources.base import JobSourceProvider, ProviderError
from autojob.job_sources.remotive import RemotiveProvider
from autojob.job_sources.serpapi import (
    SerpAPILinkedInProvider,
    google_date_tbs,
    has_closed_linkedin_application_signal,
    linkedin_apply_cta_is_empty,
    linkedin_queries,
)


class FakeProvider(JobSourceProvider):
    source_id = "fake"
    display_name = "Fake"

    def __init__(self, jobs: list[JobOffer] | None = None, error: str = "") -> None:
        super().__init__()
        self._jobs = jobs or []
        self._error = error

    def search(self, params: SearchParams) -> list[JobOffer]:
        if self._error:
            raise ProviderError(self._error)
        return self._jobs

    def normalize(self, raw_item):
        raise NotImplementedError


def job(**overrides) -> JobOffer:
    values = {
        "source": "Fake",
        "external_id": "1",
        "title": "Java Developer",
        "company": "Acme",
        "location": "Remote",
        "url": "https://example.com/jobs/java?utm_source=test",
        "description": "Java Spring Boot role with backend APIs.",
        "remote": True,
        "seniority": "junior",
        "employment_type": "full_time",
    }
    values.update(overrides)
    return JobOffer(**values)


class FakeLinkedInResponse:
    def __init__(self, text: str, status_code: int = 200, url: str = "https://www.linkedin.com/jobs/view/1") -> None:
        self.text = text
        self.status_code = status_code
        self.url = url


class SearchEngineTests(unittest.TestCase):
    def test_dedupe_jobs_by_normalized_url(self) -> None:
        jobs = [
            job(source="One", external_id="a"),
            job(source="Two", external_id="b", url="https://example.com/jobs/java"),
        ]

        result = dedupe_jobs(jobs)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].source, "One")

    def test_run_job_search_returns_partial_when_one_provider_fails(self) -> None:
        providers = [
            FakeProvider([job()]),
            FakeProvider(error="timeout"),
        ]
        providers[1].source_id = "broken"
        providers[1].display_name = "Broken"

        with (
            patch("autojob.search_engine.db.create_search_run", return_value=12),
            patch("autojob.search_engine.db.finish_search_run") as finish_run,
            patch("autojob.search_engine.db.find_duplicate_job_id", return_value=None),
            patch("autojob.search_engine.db.find_discarded_job_id", return_value=None),
            patch("autojob.search_engine.db.upsert_job", return_value=(99, True)) as upsert_job,
        ):
            result = run_job_search(SearchParams(query="Java", limit=10), providers=providers)

        self.assertEqual(result.status, "partial")
        self.assertEqual(result.saved_ids, [99])
        self.assertEqual(result.new_job_ids, [99])
        self.assertEqual(result.updated_job_ids, [])
        self.assertEqual(result.errors[0]["source"], "broken")
        upsert_job.assert_called_once()
        finish_run.assert_called_once()

    def test_junior_filter_rejects_senior_roles(self) -> None:
        providers = [
            FakeProvider(
                [
                    job(external_id="junior", title="Junior Java Developer", seniority="junior"),
                    job(external_id="senior", title="Senior Java Developer", seniority="senior"),
                ]
            )
        ]

        with (
            patch("autojob.search_engine.db.create_search_run", return_value=13),
            patch("autojob.search_engine.db.finish_search_run"),
            patch("autojob.search_engine.db.find_duplicate_job_id", return_value=None),
            patch("autojob.search_engine.db.find_discarded_job_id", return_value=None),
            patch("autojob.search_engine.db.upsert_job", side_effect=[(1, True)]),
        ):
            result = run_job_search(SearchParams(query="Java", junior_only=True), providers=providers)

        self.assertEqual(result.total_found, 1)
        self.assertEqual(result.jobs[0].seniority, "junior")

    def test_parse_date_accepts_serpapi_relative_dates(self) -> None:
        self.assertIsNotNone(parse_date("3 days ago"))
        self.assertIsNotNone(parse_date("Apr 21, 2026"))

    def test_run_job_search_skips_discarded_jobs(self) -> None:
        providers = [FakeProvider([job()])]

        with (
            patch("autojob.search_engine.db.create_search_run", return_value=14),
            patch("autojob.search_engine.db.finish_search_run") as finish_run,
            patch("autojob.search_engine.db.find_discarded_job_id", return_value=77),
            patch("autojob.search_engine.db.upsert_job") as upsert_job,
        ):
            result = run_job_search(SearchParams(query="Java", limit=10), providers=providers)

        self.assertEqual(result.jobs, [])
        self.assertEqual(result.saved_ids, [])
        self.assertEqual(result.discarded_ids, [77])
        self.assertEqual(result.total_discarded, 1)
        self.assertEqual(result.sources[0]["discarded"], 1)
        upsert_job.assert_not_called()
        finish_run.assert_called_once()

    def test_remotive_normalize_sets_internal_shape(self) -> None:
        raw = {
            "id": 123,
            "title": "Backend Java Junior Developer",
            "company_name": "Acme",
            "candidate_required_location": "Worldwide",
            "url": "https://remotive.com/jobs/123",
            "description": "<p>Build Java APIs with Spring Boot.</p>",
            "salary": "$50k",
            "tags": ["Java", "Spring"],
            "job_type": "full_time",
            "publication_date": "2026-05-01T00:00:00",
        }

        normalized = RemotiveProvider().normalize(raw)

        self.assertEqual(normalized.source, "Remotive")
        self.assertEqual(normalized.external_id, "123")
        self.assertTrue(normalized.remote)
        self.assertEqual(normalized.seniority, "junior")
        self.assertEqual(normalized.employment_type, "full_time")

    def test_serpapi_linkedin_normalize_sets_linkedin_shape(self) -> None:
        raw = {
            "title": "BairesDev hiring Junior Java Developer - Remote Work",
            "link": "https://www.linkedin.com/jobs/view/junior-java-developer-remote-work-at-bairesdev-4407197978",
            "snippet": "Develop and maintain Java applications. This is a remote role.",
        }

        normalized = SerpAPILinkedInProvider().normalize(raw)

        self.assertEqual(normalized.source, "LinkedIn via SerpAPI")
        self.assertEqual(normalized.external_id, "4407197978")
        self.assertEqual(normalized.title, "Junior Java Developer - Remote Work")
        self.assertEqual(normalized.company, "BairesDev")
        self.assertTrue(normalized.remote)

    def test_serpapi_linkedin_queries_broaden_location_search(self) -> None:
        queries = linkedin_queries(
            SearchParams(query="Java Junior", location="Colombia", remote_only=True, date_filter="7d")
        )

        self.assertIn("site:linkedin.com/jobs/view Java Junior remote Colombia", queries)
        self.assertIn("site:linkedin.com/jobs/view Java Junior developer remote Colombia", queries)
        self.assertIn("site:linkedin.com/jobs/view Java Junior remote", queries)
        self.assertEqual(google_date_tbs("24h"), "qdr:d")
        self.assertEqual(google_date_tbs("7d"), "qdr:w")
        self.assertEqual(google_date_tbs("30d"), "qdr:m")

    def test_linkedin_closed_application_signal_detects_expired_jobs(self) -> None:
        self.assertTrue(has_closed_linkedin_application_signal("Ya no se aceptan solicitudes"))
        self.assertTrue(has_closed_linkedin_application_signal("No longer accepting applications"))
        self.assertFalse(has_closed_linkedin_application_signal("Solicita ahora y revisa la descripcion."))

    def test_linkedin_empty_apply_cta_detects_closed_jobs(self) -> None:
        closed_html = '<div class="top-card-layout__cta-container flex"><!----> <!----></div>'
        open_html = (
            '<div class="top-card-layout__cta-container flex">'
            '<button class="apply-button" data-tracking-control-name="public_jobs_apply-link-onsite">Solicitar</button>'
            "</div>"
        )

        self.assertTrue(linkedin_apply_cta_is_empty(closed_html))
        self.assertFalse(linkedin_apply_cta_is_empty(open_html))

    def test_serpapi_linkedin_skips_closed_jobs_from_snippet(self) -> None:
        provider = SerpAPILinkedInProvider()
        payload = {
            "organic_results": [
                {
                    "title": "BairesDev hiring Senior Java Developer - Remote Work",
                    "link": "https://www.linkedin.com/jobs/view/senior-java-developer-remote-work-at-bairesdev-4407197978",
                    "snippet": "Hace 6 dias. Ya no se aceptan solicitudes.",
                }
            ]
        }

        with (
            patch.object(provider, "_get_json", return_value=payload),
            patch("autojob.job_sources.serpapi.requests.get") as get,
        ):
            jobs = provider.search(SearchParams(query="Java Developer", limit=5))

        self.assertEqual(jobs, [])
        self.assertEqual(provider.last_expired_count, 1)
        get.assert_not_called()

    def test_serpapi_linkedin_skips_closed_jobs_from_visible_page_text(self) -> None:
        provider = SerpAPILinkedInProvider()
        payload = {
            "organic_results": [
                {
                    "title": "BairesDev hiring Senior Java Developer - Remote Work",
                    "link": "https://www.linkedin.com/jobs/view/senior-java-developer-remote-work-at-bairesdev-4407197978",
                    "snippet": "Build Java services. Hace 6 dias.",
                }
            ]
        }
        html = """
        <html>
          <body>
            <button>Iniciar sesion</button>
            <div class="modal">Inicia sesion para ver a quien conoces</div>
            <span class="closed">Ya no se aceptan solicitudes</span>
          </body>
        </html>
        """

        with (
            patch.object(provider, "_get_json", return_value=payload),
            patch("autojob.job_sources.serpapi.requests.get", return_value=FakeLinkedInResponse(html)),
        ):
            jobs = provider.search(SearchParams(query="Java Developer", limit=5))

        self.assertEqual(jobs, [])
        self.assertEqual(provider.last_expired_count, 1)

    def test_search_jobs_endpoint_delegates_to_engine(self) -> None:
        fake_result = {
            "run_id": 1,
            "status": "completed",
            "total_found": 0,
            "total_saved": 0,
            "duplicates": 0,
            "saved": 0,
            "errors": [],
            "sources": [],
            "jobs": [],
            "saved_ids": [],
        }

        with patch("autojob.routers.search.run_job_search") as run_search, patch(
            "autojob.routers.search.search_result_dict",
            return_value=fake_result,
        ):
            run_search.return_value = object()
            response = TestClient(api.app).post(
                "/api/search/jobs",
                json={
                    "query": "Java Developer",
                    "remote_only": True,
                    "limit": 5,
                    "selected_sources": ["remotive"],
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        called_params = run_search.call_args.args[0]
        self.assertEqual(called_params.query, "Java Developer")
        self.assertTrue(called_params.remote_only)
        self.assertEqual(called_params.selected_sources, ["remotive"])

    def test_sources_endpoint_lists_real_and_optional_sources(self) -> None:
        response = TestClient(api.app).get("/api/sources")

        self.assertEqual(response.status_code, 200)
        source_ids = {source["id"] for source in response.json()}
        self.assertIn("remotive", source_ids)
        self.assertIn("arbeitnow", source_ids)
        self.assertIn("remoteok", source_ids)
        self.assertIn("adzuna", source_ids)
        self.assertIn("serpapi", source_ids)
        self.assertIn("serpapi_linkedin", source_ids)


if __name__ == "__main__":
    unittest.main()
