from __future__ import annotations

import unittest

from autojob.analyzer import analyze_job
from autojob.models import JobOffer, UserProfile


class AnalyzerTests(unittest.TestCase):
    def _job(self, **overrides) -> JobOffer:
        values = {
            "source": "test",
            "external_id": "1",
            "title": "Python Backend Developer",
            "company": "Acme",
            "location": "Remote",
            "url": "https://example.com/job",
            "description": "Python FastAPI PostgreSQL Docker role building backend APIs.",
            "tags": ["Python", "FastAPI"],
            "remote": True,
        }
        values.update(overrides)
        return JobOffer(**values)

    def test_empty_profile_adds_profile_guidance(self) -> None:
        result = analyze_job(UserProfile(), self._job())
        self.assertIn("Configura tus habilidades", " ".join(result.reasons))
        self.assertIn("Configura palabras objetivo", " ".join(result.reasons))

    def test_empty_job_description_still_scores_metadata(self) -> None:
        profile = UserProfile(skills="Python", keywords="Backend")
        result = analyze_job(profile, self._job(description=""))
        self.assertGreaterEqual(result.score, 0)
        self.assertLessEqual(result.score, 100)

    def test_full_skill_match_reports_skills(self) -> None:
        profile = UserProfile(skills="Python, FastAPI", keywords="Backend")
        result = analyze_job(profile, self._job())
        self.assertIn("Python", result.matched_skills)
        self.assertIn("FastAPI", result.matched_skills)
        self.assertGreater(result.score, 60)

    def test_zero_skill_match_reports_no_direct_matches(self) -> None:
        profile = UserProfile(skills="Cobol", keywords="Mainframe")
        result = analyze_job(profile, self._job())
        self.assertEqual(result.matched_skills, [])
        self.assertIn("No se encontraron coincidencias", " ".join(result.reasons))


if __name__ == "__main__":
    unittest.main()
