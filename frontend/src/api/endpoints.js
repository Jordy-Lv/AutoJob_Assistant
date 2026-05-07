function query(params = {}) {
  const clean = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "");
  const qs = new URLSearchParams(clean).toString();
  return qs ? `?${qs}` : "";
}

export const endpoints = {
  health: () => "/api/health",
  overview: () => "/api/overview",
  profile: () => "/api/profile",
  sources: {
    list: () => "/api/sources",
    searchList: () => "/api/search/sources",
    health: () => "/api/search/sources/health",
  },
  search: {
    jobs: () => "/api/search/jobs",
    runs: (params) => `/api/search/runs${query(params)}`,
  },
  jobs: {
    list: (params) => `/api/jobs${query(params)}`,
    get: (id) => `/api/jobs/${id}`,
    manual: () => "/api/jobs/manual",
    importUrl: () => "/api/jobs/import-url",
    importText: () => "/api/jobs/import-text",
    applications: (params) => `/api/jobs/applications${query(params)}`,
    status: (id) => `/api/jobs/${id}/status`,
    discard: (id) => `/api/jobs/${id}/discard`,
    discardBulk: () => "/api/jobs/discard-bulk",
    viewed: (id) => `/api/jobs/${id}/viewed`,
    analyze: (id) => `/api/jobs/${id}/analyze`,
    documents: (id) => `/api/jobs/${id}/documents`,
    delete: (id) => `/api/jobs/${id}`,
    apply: (id) => `/api/jobs/${id}/apply`,
  },
  documents: {
    list: () => "/api/documents",
    view: (id) => `/api/documents/${id}`,
    download: (id) => `/api/documents/${id}/download`,
  },
  savedSearches: {
    list: (params) => `/api/saved-searches${query(params)}`,
    create: () => "/api/saved-searches",
    get: (id) => `/api/saved-searches/${id}`,
    update: (id) => `/api/saved-searches/${id}`,
    delete: (id) => `/api/saved-searches/${id}`,
    run: (id) => `/api/saved-searches/${id}/run`,
    notifications: (id, params) => `/api/saved-searches/${id}/notifications${query(params)}`,
  },
};
