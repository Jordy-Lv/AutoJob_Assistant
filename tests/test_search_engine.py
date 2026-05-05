from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import MagicMock, call, patch

from fastapi.testclient import TestClient

import api
from autojob.models import JobOffer, SearchParams
from autojob.search_engine import dedupe_jobs, matches_date_filter, parse_date, run_job_search
from autojob.job_sources.base import JobSourceProvider, ProviderError
from autojob.job_sources.linkedin_serp import LinkedInSerpProvider, _is_expired_result
from autojob.job_sources.remotive import RemotiveProvider
from autojob.job_sources.serpapi import (
    SerpAPIProvider,
    SerpAPILinkedInProvider,
    _extract_date_uds,
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


# ---------------------------------------------------------------------------
# Existing tests (preserved)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# New: matches_date_filter with extended values
# ---------------------------------------------------------------------------

class DateFilterTests(unittest.TestCase):
    def _now_minus(self, days: float) -> str:
        dt = datetime.now(timezone.utc) - timedelta(days=days)
        return dt.isoformat()

    def test_any_filter_always_passes(self) -> None:
        self.assertTrue(matches_date_filter("", "any"))
        self.assertTrue(matches_date_filter("", ""))
        self.assertTrue(matches_date_filter("old", "any"))

    def test_4d_accepts_job_from_3_days_ago(self) -> None:
        published = self._now_minus(3)
        self.assertTrue(matches_date_filter(published, "4d"))

    def test_4d_rejects_job_from_5_days_ago(self) -> None:
        published = self._now_minus(5)
        self.assertFalse(matches_date_filter(published, "4d"))

    def test_3d_accepts_job_from_2_days_ago(self) -> None:
        self.assertTrue(matches_date_filter(self._now_minus(2), "3d"))

    def test_3d_rejects_job_from_4_days_ago(self) -> None:
        self.assertFalse(matches_date_filter(self._now_minus(4), "3d"))

    def test_14d_accepts_job_from_13_days_ago(self) -> None:
        self.assertTrue(matches_date_filter(self._now_minus(13), "14d"))

    def test_14d_rejects_job_from_15_days_ago(self) -> None:
        self.assertFalse(matches_date_filter(self._now_minus(15), "14d"))

    def test_missing_date_rejected_when_filter_active(self) -> None:
        self.assertFalse(matches_date_filter("", "4d"))
        self.assertFalse(matches_date_filter("  ", "7d"))

    def test_unparseable_date_rejected_when_filter_active(self) -> None:
        self.assertFalse(matches_date_filter("no_date_here", "4d"))


# ---------------------------------------------------------------------------
# New: parse_date with English and Spanish relative strings
# ---------------------------------------------------------------------------

class ParseDateTests(unittest.TestCase):
    def _recent(self, dt: datetime | None, max_seconds: int = 5) -> bool:
        if dt is None:
            return False
        return abs((datetime.now(timezone.utc) - dt).total_seconds()) <= max_seconds

    def test_iso_format(self) -> None:
        result = parse_date("2026-05-01T12:00:00Z")
        self.assertIsNotNone(result)
        self.assertEqual(result.year, 2026)

    def test_just_posted_english(self) -> None:
        self.assertTrue(self._recent(parse_date("just posted")))

    def test_today_english(self) -> None:
        self.assertTrue(self._recent(parse_date("today")))

    def test_hoy_spanish(self) -> None:
        self.assertTrue(self._recent(parse_date("hoy")))

    def test_yesterday_english(self) -> None:
        result = parse_date("yesterday")
        self.assertIsNotNone(result)
        diff = (datetime.now(timezone.utc) - result).total_seconds()
        self.assertAlmostEqual(diff / 3600, 24, delta=1)

    def test_ayer_spanish(self) -> None:
        result = parse_date("ayer")
        self.assertIsNotNone(result)
        diff = (datetime.now(timezone.utc) - result).total_seconds()
        self.assertAlmostEqual(diff / 3600, 24, delta=1)

    def test_2_days_ago_english(self) -> None:
        result = parse_date("2 days ago")
        self.assertIsNotNone(result)
        diff = (datetime.now(timezone.utc) - result).total_seconds()
        self.assertAlmostEqual(diff / 86400, 2, delta=0.1)

    def test_hace_2_dias_spanish(self) -> None:
        result = parse_date("hace 2 días")
        self.assertIsNotNone(result)
        diff = (datetime.now(timezone.utc) - result).total_seconds()
        self.assertAlmostEqual(diff / 86400, 2, delta=0.1)

    def test_hace_3_horas_spanish(self) -> None:
        # Hours map to 0 days → result is "now"
        result = parse_date("hace 3 horas")
        self.assertTrue(self._recent(result, max_seconds=5))

    def test_3_hours_ago_english(self) -> None:
        result = parse_date("3 hours ago")
        self.assertTrue(self._recent(result, max_seconds=5))

    def test_hace_1_semana_spanish(self) -> None:
        result = parse_date("hace 1 semana")
        self.assertIsNotNone(result)
        diff = (datetime.now(timezone.utc) - result).total_seconds()
        self.assertAlmostEqual(diff / 86400, 7, delta=0.1)

    def test_1_week_ago_english(self) -> None:
        result = parse_date("1 week ago")
        self.assertIsNotNone(result)
        diff = (datetime.now(timezone.utc) - result).total_seconds()
        self.assertAlmostEqual(diff / 86400, 7, delta=0.1)

    def test_unknown_string_returns_none(self) -> None:
        self.assertIsNone(parse_date("some random text"))
        self.assertIsNone(parse_date(""))


# ---------------------------------------------------------------------------
# New: SerpAPIProvider pagination with next_page_token
# ---------------------------------------------------------------------------

class SerpAPIProviderTests(unittest.TestCase):
    def _make_page(self, jobs: list[dict], next_token: str | None = None) -> dict:
        result: dict = {"jobs_results": jobs}
        if next_token:
            result["serpapi_pagination"] = {"next_page_token": next_token}
        return result

    def _sample_job(self, suffix: str = "") -> dict:
        return {
            "job_id": f"job_{suffix}",
            "title": f"Python Dev {suffix}",
            "company_name": "Acme",
            "location": "Remote",
            "description": "Build great things.",
            "apply_options": [{"link": f"https://example.com/jobs/{suffix}"}],
            "detected_extensions": {"posted_at": "3 days ago"},
        }

    def test_paginates_with_next_page_token(self) -> None:
        page1 = self._make_page([self._sample_job("1")], next_token="tok_page2")
        page2 = self._make_page([self._sample_job("2")], next_token=None)

        provider = SerpAPIProvider()
        with patch.object(provider, "_get_json", side_effect=[page1, page2]) as mock_get:
            results = provider.search(SearchParams(query="python", limit=5, date_filter="any"))

        self.assertEqual(len(results), 2)
        call_params = [c.args[1] for c in mock_get.call_args_list]
        # First call has no next_page_token
        self.assertNotIn("next_page_token", call_params[0])
        # Second call carries the token from page1
        self.assertEqual(call_params[1].get("next_page_token"), "tok_page2")

    def test_stops_when_no_more_pages(self) -> None:
        page1 = self._make_page([self._sample_job("1")])  # no next token

        provider = SerpAPIProvider()
        with patch.object(provider, "_get_json", return_value=page1) as mock_get:
            results = provider.search(SearchParams(query="python", limit=5, date_filter="any"))

        mock_get.assert_called_once()
        self.assertEqual(len(results), 1)

    def test_no_chips_in_base_request(self) -> None:
        """The base (no date filter) request must not include chips."""
        page = self._make_page([self._sample_job()])

        provider = SerpAPIProvider()
        with patch.object(provider, "_get_json", return_value=page) as mock_get:
            provider.search(SearchParams(query="python", limit=5, date_filter=""))

        params_used = mock_get.call_args.args[1]
        self.assertNotIn("chips", params_used)
        self.assertNotIn("uds", params_used)

    def test_uses_chips_fallback_when_no_uds_in_filters(self) -> None:
        """When the probe response has no Date posted filters, chips is used."""
        probe_page = self._make_page([])  # no filters key
        filtered_page = self._make_page([self._sample_job()])

        provider = SerpAPIProvider()
        with patch.dict("os.environ", {"SERPAPI_KEY": "fake-key"}):
            with patch.object(provider, "_get_json", side_effect=[probe_page, filtered_page]) as mock_get:
                provider.search(SearchParams(query="python", limit=5, date_filter="7d"))

        # Second call should use chips fallback
        second_call_params = mock_get.call_args_list[1].args[1]
        self.assertIn("chips", second_call_params)
        self.assertEqual(second_call_params["chips"], "date_posted:week")

    def test_no_results_error_returns_empty_list(self) -> None:
        provider = SerpAPIProvider()
        with patch.object(
            provider,
            "_get_json",
            return_value={"error": "Google hasn't returned any results for this query."},
        ):
            results = provider.search(SearchParams(query="rare role", limit=5, date_filter="any"))

        self.assertEqual(results, [])

    def test_probe_no_results_error_falls_back_to_broader_chips(self) -> None:
        provider = SerpAPIProvider()
        no_results = {"error": "Google hasn't returned any results for this query."}
        filtered_page = self._make_page([self._sample_job()])
        with patch.object(provider, "_get_json", side_effect=[no_results, filtered_page]) as mock_get:
            provider.search(SearchParams(query="python", limit=5, date_filter="24h"))

        second_call_params = mock_get.call_args_list[1].args[1]
        self.assertEqual(second_call_params.get("chips"), "date_posted:3days")

    def test_probe_exception_falls_back_to_chips(self) -> None:
        provider = SerpAPIProvider()
        filtered_page = self._make_page([self._sample_job()])
        with patch.object(provider, "_get_json", side_effect=[RuntimeError("temporary probe failure"), filtered_page]) as mock_get:
            provider.search(SearchParams(query="python", limit=5, date_filter="7d"))

        second_call_params = mock_get.call_args_list[1].args[1]
        self.assertEqual(second_call_params.get("chips"), "date_posted:week")

    def test_uses_uds_when_available_in_filters(self) -> None:
        """When the probe response contains a matching Date posted uds, it is used."""
        probe_page = {
            "jobs_results": [],
            "filters": [
                {
                    "type": "Date posted",
                    "options": [
                        {"text": "Past week", "uds": "test_uds_token"},
                    ],
                }
            ],
        }
        filtered_page = self._make_page([self._sample_job()])

        provider = SerpAPIProvider()
        with patch.dict("os.environ", {"SERPAPI_KEY": "fake-key"}):
            with patch.object(provider, "_get_json", side_effect=[probe_page, filtered_page]) as mock_get:
                provider.search(SearchParams(query="python", limit=5, date_filter="7d"))

        second_call_params = mock_get.call_args_list[1].args[1]
        self.assertEqual(second_call_params.get("uds"), "test_uds_token")
        self.assertNotIn("chips", second_call_params)


class ExtractDateUdsTests(unittest.TestCase):
    def test_extracts_matching_option(self) -> None:
        payload = {
            "filters": [
                {
                    "type": "Date posted",
                    "options": [
                        {"text": "Past week", "uds": "abc123"},
                        {"text": "Past month", "uds": "def456"},
                    ],
                }
            ]
        }
        uds, q = _extract_date_uds(payload, ["past week", "last week"])
        self.assertEqual(uds, "abc123")
        self.assertIsNone(q)

    def test_extracts_matching_option_from_name_field(self) -> None:
        payload = {
            "filters": [
                {
                    "name": "Date posted",
                    "options": [
                        {"name": "Last 3 days", "uds": "name_field_uds", "q": "python in the last 3 days"},
                    ],
                }
            ]
        }
        uds, q = _extract_date_uds(payload, ["last 3 days"])
        self.assertEqual(uds, "name_field_uds")
        self.assertEqual(q, "python in the last 3 days")

    def test_returns_none_when_no_match(self) -> None:
        payload = {"filters": [{"type": "Date posted", "options": [{"text": "Past month", "uds": "xyz"}]}]}
        uds, q = _extract_date_uds(payload, ["yesterday", "today"])
        self.assertIsNone(uds)

    def test_returns_none_for_empty_payload(self) -> None:
        uds, q = _extract_date_uds({}, ["past week"])
        self.assertIsNone(uds)
        self.assertIsNone(q)


# ---------------------------------------------------------------------------
# New: LinkedInSerpProvider expired listing detection
# ---------------------------------------------------------------------------

class LinkedInExpiredDetectionTests(unittest.TestCase):
    def test_is_expired_result_detects_closed(self) -> None:
        self.assertTrue(_is_expired_result("Senior Dev - Acme", "This position is no longer accepting applications"))
        self.assertTrue(_is_expired_result("Dev role - closed", ""))
        self.assertTrue(_is_expired_result("", "expired"))

    def test_is_expired_result_detects_spanish(self) -> None:
        self.assertTrue(_is_expired_result("Desarrollador Python", "Oferta cerrada"))
        self.assertTrue(_is_expired_result("Oferta caducada - Empresa", ""))

    def test_is_expired_result_accepts_valid_snippet(self) -> None:
        self.assertFalse(_is_expired_result("Senior Python Developer", "We are hiring a backend engineer to join our team."))

    def test_normalize_result_returns_none_for_expired_snippet(self) -> None:
        provider = LinkedInSerpProvider()
        raw = {
            "link": "https://www.linkedin.com/jobs/view/12345",
            "title": "Senior Dev - Acme Corp | LinkedIn",
            "snippet": "This position is no longer accepting applications.",
        }
        result = provider._normalize_result(raw, "Remote")
        self.assertIsNone(result)

    def test_normalize_result_accepts_valid_listing(self) -> None:
        provider = LinkedInSerpProvider()
        raw = {
            "link": "https://www.linkedin.com/jobs/view/99999",
            "title": "Backend Engineer - Acme Corp - Remote | LinkedIn",
            "snippet": "Join our engineering team. You will build scalable APIs.",
        }
        result = provider._normalize_result(raw, "Remote")
        self.assertIsNotNone(result)
        self.assertEqual(result.title, "Backend Engineer")

    def test_24h_search_uses_week_window_for_google_indexing_lag(self) -> None:
        provider = LinkedInSerpProvider()
        with patch.object(provider, "_get_json", return_value={"organic_results": []}) as mock_get:
            provider.search(SearchParams(query="python", location="Remote", limit=5, date_filter="24h"))

        params_used = mock_get.call_args.args[1]
        self.assertEqual(params_used["tbs"], "qdr:w")


if __name__ == "__main__":
    unittest.main()
