from __future__ import annotations

import re
import unicodedata
from collections import Counter

from .models import AnalysisResult, JobOffer, UserProfile, split_items


STOP_WORDS = {
    "about",
    "above",
    "and",
    "are",
    "con",
    "del",
    "desde",
    "for",
    "from",
    "las",
    "los",
    "para",
    "por",
    "que",
    "the",
    "una",
    "will",
    "with",
    "you",
    "your",
}

TECH_VOCABULARY = {
    "agile",
    "angular",
    "api",
    "aws",
    "azure",
    "beautifulsoup",
    "ci",
    "css",
    "django",
    "docker",
    "fastapi",
    "flask",
    "git",
    "graphql",
    "html",
    "java",
    "javascript",
    "kubernetes",
    "linux",
    "mongodb",
    "next.js",
    "node",
    "node.js",
    "playwright",
    "postgresql",
    "python",
    "react",
    "redis",
    "rest",
    "sql",
    "sqlite",
    "streamlit",
    "typescript",
    "vue",
}


def normalize(value: str) -> str:
    lowered = value.lower().strip()
    ascii_text = unicodedata.normalize("NFKD", lowered).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", ascii_text)


def tokenize(value: str) -> list[str]:
    normalized = normalize(value)
    tokens = re.findall(r"[a-z0-9][a-z0-9+#.]{1,}", normalized)
    return [token for token in tokens if token not in STOP_WORDS and len(token) > 2]


def extract_keywords(value: str, limit: int = 30) -> list[str]:
    counts = Counter(tokenize(value))
    return [word for word, _ in counts.most_common(limit)]


def _contains(text: str, candidate: str) -> bool:
    normalized_text = normalize(text)
    normalized_candidate = normalize(candidate)
    if not normalized_candidate:
        return False
    return normalized_candidate in normalized_text


def _score_ratio(matches: int, total: int, weight: float) -> float:
    if total <= 0:
        return 0.0
    return min(weight, (matches / total) * weight)


def analyze_job(profile: UserProfile, job: JobOffer) -> AnalysisResult:
    full_job_text = " ".join(
        [
            job.title,
            job.company,
            job.location,
            job.description,
            " ".join(job.tags),
        ]
    )

    profile_skills = profile.skills_list()
    matched_skills = [
        skill for skill in profile_skills if _contains(full_job_text, skill)
    ]

    requested_keywords = profile.keywords_list()
    if profile.target_role:
        requested_keywords.extend(split_items(profile.target_role.replace("/", ",")))
    keyword_matches = [
        keyword for keyword in requested_keywords if _contains(full_job_text, keyword)
    ]

    role_match = 0.0
    if profile.target_role and _contains(job.title, profile.target_role):
        role_match = 15.0
    elif profile.target_role and any(
        token in tokenize(job.title) for token in tokenize(profile.target_role)
    ):
        role_match = 9.0

    job_tokens = set(extract_keywords(full_job_text, limit=80))
    profile_skill_tokens = {normalize(skill) for skill in profile_skills}
    profile_skill_words = {token for skill in profile_skills for token in tokenize(skill)}
    requested_tech = sorted(job_tokens.intersection(TECH_VOCABULARY))
    known_tech = profile_skill_tokens.union(profile_skill_words)
    gaps = [tech for tech in requested_tech if tech not in known_tech]

    score = 0.0
    score += _score_ratio(len(matched_skills), len(profile_skills), 45.0)
    score += _score_ratio(len(keyword_matches), len(requested_keywords), 20.0)
    score += role_match

    location_text = normalize(job.location)
    if "remote" in location_text or "remoto" in location_text or "worldwide" in location_text:
        score += 10.0
    elif job.location:
        score += 5.0

    if job.description:
        score += 5.0
    if job.url:
        score += 5.0

    score = round(min(100.0, score), 1)

    reasons: list[str] = []
    if matched_skills:
        reasons.append(
            "Coinciden habilidades clave: " + ", ".join(matched_skills[:8])
        )
    else:
        reasons.append("No se encontraron coincidencias directas con las habilidades guardadas.")

    if keyword_matches:
        reasons.append("Coinciden palabras objetivo: " + ", ".join(keyword_matches[:8]))
    if role_match:
        reasons.append("El titulo de la oferta se alinea con el rol objetivo.")
    if "remote" in location_text or "remoto" in location_text:
        reasons.append("La oferta indica modalidad remota.")

    if score >= 80:
        recommendation = "Alta prioridad: preparar aplicacion personalizada."
    elif score >= 60:
        recommendation = "Buena opcion: revisar brechas antes de aplicar."
    elif score >= 40:
        recommendation = "Posible opcion: requiere ajuste del CV o mas informacion."
    else:
        recommendation = "Baja prioridad: revisar solo si la empresa o el rol interesan mucho."

    return AnalysisResult(
        score=score,
        reasons=reasons,
        gaps=gaps[:12],
        matched_skills=matched_skills[:12],
        recommendation=recommendation,
    )
