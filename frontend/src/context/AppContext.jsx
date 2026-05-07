import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { endpoints } from "@/api/endpoints";
import { request } from "@/api/client";
import { THEME_KEY } from "@/constants";

export const AppContext = createContext(null);

function getInitialTheme() {
  const saved = window.localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}

function countersFromOverview(overview = {}, savedSearches = [], sources = []) {
  return {
    ofertas: overview.total_jobs || 0,
    pendientes: overview.unanalyzed_count || 0,
    documentos: overview.documents_count || 0,
    guardados: savedSearches.length || 0,
    fuentes: sources.filter((source) => source.enabled && source.configured).length || 0,
    aplicadas: overview.applied_count || 0,
    nuevas: overview.new_count || 0,
    mejorMatch: overview.priority_jobs?.[0]?.score ?? null,
  };
}

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(getInitialTheme);
  const [counters, setCounters] = useState(countersFromOverview());
  const [health, setHealth] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const refreshCounters = useCallback(async () => {
    setRefreshing(true);
    try {
      const [overview, savedPayload, sourcesPayload] = await Promise.all([
        request(endpoints.overview()),
        request(endpoints.savedSearches.list()),
        request(endpoints.sources.list()),
      ]);
      const savedSearches = savedPayload.saved_searches || [];
      const sources = Array.isArray(sourcesPayload) ? sourcesPayload : sourcesPayload.sources || [];
      setCounters(countersFromOverview(overview, savedSearches, sources));
      setHealth(overview.health || null);
      return overview;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const checkHealth = useCallback(async () => {
    const status = await request(endpoints.health());
    setHealth(status.database || status);
    return status;
  }, []);

  useEffect(() => {
    refreshCounters().catch(() => {});
  }, [refreshCounters]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
      counters,
      health,
      refreshing,
      refreshCounters,
      checkHealth,
    }),
    [user, theme, counters, health, refreshing, refreshCounters, checkHealth],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
