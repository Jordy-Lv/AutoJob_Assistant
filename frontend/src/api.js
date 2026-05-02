const configuredBaseUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");

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

function parseErrorDetail(detail) {
  if (!detail) {
    return "";
  }

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg || item.message || JSON.stringify(item))
      .filter(Boolean)
      .join(". ");
  }

  return detail.message || JSON.stringify(detail);
}

function messageForStatus(status, fallback) {
  if (fallback) {
    return fallback;
  }

  if (status === 404) {
    return "El documento todavía no existe";
  }

  if (status === 502 || status === 503 || status === 504) {
    return "La fuente no respondió";
  }

  return `HTTP ${status}`;
}

export async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(apiUrl(path), {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
  } catch (error) {
    throw new Error("La fuente no respondió");
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(messageForStatus(response.status, parseErrorDetail(error.detail)));
  }

  if (response.status === 204) {
    return {};
  }

  return response.json();
}

export function documentViewUrl(document) {
  const url = document?.view_url || document?.download_url || document?.path;
  return url ? apiUrl(url) : "#";
}

export function documentDownloadUrl(document) {
  const url = document?.download_url || document?.view_url || document?.path;
  return url ? apiUrl(url) : "#";
}
