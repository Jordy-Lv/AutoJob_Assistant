from __future__ import annotations

import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

from autojob.ai import analyze_job_with_optional_ai
from autojob.models import JobOffer, UserProfile


def job() -> JobOffer:
    return JobOffer(
        source="test",
        external_id="1",
        title="Python Developer",
        company="Acme",
        description="Python APIs",
    )


class AiTests(unittest.TestCase):
    def test_uses_chat_completions_create(self) -> None:
        create = MagicMock()
        create.return_value.choices = [
            types.SimpleNamespace(
                message=types.SimpleNamespace(
                    content=json.dumps({
                        "score": 88,
                        "reasons": ["Coincide"],
                        "gaps": [],
                        "matched_skills": ["Python"],
                        "recommendation": "Alta prioridad",
                    })
                )
            )
        ]
        client = MagicMock()
        client.chat.completions.create = create
        module = types.SimpleNamespace(OpenAI=MagicMock(return_value=client))

        with patch.dict(sys.modules, {"openai": module}), patch.dict("os.environ", {"OPENAI_API_KEY": "key"}):
            result = analyze_job_with_optional_ai(UserProfile(skills="Python"), job(), use_ai=True)

        create.assert_called_once()
        self.assertEqual(result.score, 88)
        self.assertEqual(result.matched_skills, ["Python"])

    def test_api_exception_falls_back(self) -> None:
        client = MagicMock()
        client.chat.completions.create.side_effect = RuntimeError("boom")
        module = types.SimpleNamespace(OpenAI=MagicMock(return_value=client))

        with patch.dict(sys.modules, {"openai": module}), patch.dict("os.environ", {"OPENAI_API_KEY": "key"}):
            result = analyze_job_with_optional_ai(UserProfile(skills="Python"), job(), use_ai=True)

        self.assertIsInstance(result.score, float)
        self.assertIn("Python", result.matched_skills)

    def test_invalid_json_falls_back(self) -> None:
        client = MagicMock()
        client.chat.completions.create.return_value.choices = [
            types.SimpleNamespace(message=types.SimpleNamespace(content="not json"))
        ]
        module = types.SimpleNamespace(OpenAI=MagicMock(return_value=client))

        with patch.dict(sys.modules, {"openai": module}), patch.dict("os.environ", {"OPENAI_API_KEY": "key"}):
            result = analyze_job_with_optional_ai(UserProfile(skills="Python"), job(), use_ai=True)

        self.assertIn("Python", result.matched_skills)


if __name__ == "__main__":
    unittest.main()
