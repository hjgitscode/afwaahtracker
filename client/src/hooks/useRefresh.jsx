import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api } from '../services/api.js';

const RefreshContext = createContext({ refreshing: false, version: 0, lastResult: null, lastError: null, refresh: async () => {} });

/**
 * Shared "REFRESH DATA" state: the navbar button and the Live Feed page both
 * call refresh(); when ingestion finishes `version` increments so pages refetch.
 */
export function RefreshProvider({ children }) {
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [lastError, setLastError] = useState(null);

  const refresh = useCallback(async () => {
    if (refreshing) return null;
    setRefreshing(true);
    setLastError(null);
    try {
      const result = await api.refresh();
      setLastResult(result);
      return result;
    } catch (err) {
      setLastError(err);
      return null;
    } finally {
      setRefreshing(false);
      setVersion((v) => v + 1);
    }
  }, [refreshing]);

  const dismiss = useCallback(() => {
    setLastResult(null);
    setLastError(null);
  }, []);

  const value = useMemo(
    () => ({ refreshing, version, lastResult, lastError, refresh, dismiss }),
    [refreshing, version, lastResult, lastError, refresh, dismiss]
  );
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export const useRefresh = () => useContext(RefreshContext);
