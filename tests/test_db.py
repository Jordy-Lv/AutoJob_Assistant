from __future__ import annotations

import unittest

from autojob.db import job_identity_fingerprint, normalize_job_url


class DbUtilityTests(unittest.TestCase):
    def test_normalize_job_url_removes_tracking_params(self) -> None:
        url = "https://www.example.com/jobs/123/?utm_source=x&ref=abc&page=1"
        self.assertEqual(normalize_job_url(url), "https://example.com/jobs/123?page=1")

    def test_normalize_job_url_rejects_non_http_without_crashing(self) -> None:
        self.assertEqual(normalize_job_url("mailto:test@example.com"), "mailto:test@example.com")

    def test_job_identity_fingerprint_requires_title_and_company(self) -> None:
        self.assertEqual(job_identity_fingerprint("", "Acme", "Remote"), "")
        self.assertEqual(job_identity_fingerprint("Dev", "", "Remote"), "")

    def test_job_identity_fingerprint_normalizes_parts(self) -> None:
        self.assertEqual(
            job_identity_fingerprint("Senior Python Dev!!", "ACME, Inc.", "Remote - CO"),
            "senior python dev|acme inc|remote co",
        )


if __name__ == "__main__":
    unittest.main()
