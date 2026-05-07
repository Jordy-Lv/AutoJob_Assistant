import { endpoints } from "@/api/endpoints";
import { apiUrl } from "@/api/client";
import { STATUS_LABELS } from "@/constants";

export function formatDate(value, options = {}) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatDateTime(value) {
  if (!value) return "sin fecha";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function displayStatus(status = "") {
  return STATUS_LABELS[status] || status || "Sin estado";
}

export function profileCompletion(profile = {}) {
  const fields = ["full_name", "target_role", "summary", "skills", "experience", "education", "projects", "links", "keywords"];
  const done = fields.filter((field) => String(profile?.[field] || "").trim().length > 0).length;
  return Math.round((done / fields.length) * 100);
}

export function scoreTone(score) {
  if (score == null) return "neutral";
  if (score >= 80) return "success";
  if (score >= 60) return "info";
  if (score >= 30) return "warning";
  return "danger";
}

export function statusTone(status = "") {
  if (status === "Nueva") return "primary";
  if (status === "Vista") return "neutral";
  if (status === "Interesante") return "info";
  if (status === "Lista para aplicar" || status === "Aprobada" || status === "Necesita revision") return "warning";
  if (status === "Aplicada" || status === "En aplicacion" || status === "Captcha requerido") return "success";
  if (status === "Descartada" || status === "Error") return "danger";
  return "neutral";
}

export function scoreText(score) {
  if (score == null) return "Sin score";
  return `${Math.round(score)}%`;
}

export function scoreSummary(score) {
  if (score == null) return "Sin analizar";
  if (score >= 80) return "Match fuerte";
  if (score >= 60) return "Buen match";
  if (score >= 40) return "Match parcial";
  return "Bajo encaje";
}

export function documentViewUrl(document) {
  return document?.id ? apiUrl(endpoints.documents.view(document.id)) : "#";
}

export function documentDownloadUrl(document) {
  return document?.id ? apiUrl(endpoints.documents.download(document.id)) : "#";
}

export function groupDocumentsByJob(documents = [], jobs = []) {
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const groups = new Map();

  documents.forEach((document) => {
    const job = jobsById.get(document.job_id);
    const key = document.job_id || `${document.job_title || "Oferta"}-${document.company || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        job,
        title: job?.title || document.job_title || "Oferta",
        company: job?.company || document.company || "Empresa no indicada",
        documents: [],
      });
    }
    groups.get(key).documents.push(document);
  });

  return Array.from(groups.values());
}

export function isValidUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function normalizeListPayload(payload, key) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.[key]) ? payload[key] : [];
}
