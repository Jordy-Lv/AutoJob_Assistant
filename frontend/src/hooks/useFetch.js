import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "@/api/client";

export function useFetch(fetcher, options = {}) {
  const { enabled = true, initialData = null } = options;
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    if (!enabled) return initialData;
    setLoading(true);
    setError(null);
    try {
      const result = typeof fetcher === "function" ? await fetcher() : await request(fetcher);
      if (mounted.current) {
        setData(result);
      }
      return result;
    } catch (err) {
      if (mounted.current) {
        setError(err);
      }
      throw err;
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, [enabled, fetcher, initialData]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    refetch().catch(() => {});
  }, [enabled, refetch]);

  return { data, loading, error, refetch };
}
