import { endpoints } from "./endpoints";

const configuredBaseUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

let lastApiError = null;
const subscribers = new Set();

export class ApiError extends Error {
  constructor({ message, status, endpoint, timestamp, details }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.timestamp = timestamp;
    this.details = details;
  }
}

export function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (!configuredBaseUrl) {
    return normalizedPath;
  }

  if (configuredBaseUrl.endsWith("/api") && normalizedPath.startsWith("/api/")) {
    return `${configuredBaseUrl}${normalizedPath.slice(4)}`;
  }

  return `${configuredBaseUrl}${normalizedPath}`;
}

export function getLastApiError() {
  return lastApiError;
}

export function subscribeToApiErrors(listener) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function publishError(error) {
  lastApiError = {
    endpoint: error.endpoint,
    status: error.status,
    message: error.message,
    timestamp: error.timestamp,
    details: error.details,
  };
  subscribers.forEach((listener) => listener(lastApiError));
}

function parseErrorDetail(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg || item.message || JSON.stringify(item))
      .filter(Boolean)
      .join(". ");
  }
  return detail.message || JSON.stringify(detail);
}

function messageForStatus(status, fallback) {
  if (fallback) return fallback;
  if (status === 404) return "El recurso todavia no existe.";
  if (status === 422) return "La informacion enviada no es valida.";
  if (status === 502 || status === 503 || status === 504) return "La fuente no respondio.";
  return `HTTP ${status}`;
}

async function parseJson(response) {
  if (response.status === 204) return {};
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

export async function request(endpoint, options = {}) {
  const { body, headers, ...rest } = options;
  const finalHeaders = { ...(headers || {}) };
  let finalBody = body;

  if (body !== undefined && !(body instanceof FormData)) {
    finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
    finalBody = typeof body === "string" ? body : JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(apiUrl(endpoint), {
      headers: finalHeaders,
      body: finalBody,
      ...rest,
    });
  } catch (cause) {
    const error = new ApiError({
      endpoint,
      status: 0,
      message: "No se pudo conectar con el backend.",
      timestamp: new Date().toISOString(),
      details: cause?.message,
    });
    publishError(error);
    throw error;
  }

  const payload = await parseJson(response);

  if (!response.ok) {
    const detail = parseErrorDetail(payload.detail || payload.message || payload.error);
    const error = new ApiError({
      endpoint,
      status: response.status,
      message: messageForStatus(response.status, detail),
      timestamp: new Date().toISOString(),
      details: payload,
    });
    publishError(error);
    throw error;
  }

  return payload;
}

export function documentViewUrl(document) {
  return document?.id ? apiUrl(endpoints.documents.view(document.id)) : "#";
}

export function documentDownloadUrl(document) {
  return document?.id ? apiUrl(endpoints.documents.download(document.id)) : "#";
}
