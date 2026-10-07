import { useCallback, useEffect, useRef, useState } from 'react';
import { useRefresh } from './useRefresh.jsx';

/**
 * Runs `loader(signal)` whenever `deps` change (and after every completed
 * data refresh). Returns { data, error, loading, reload }.
 */
export function useApi(loader, deps = [], { refetchOnRefresh = true, enabled = true } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: enabled });
  const { version } = useRefresh();
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    loaderRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false });
      })
      .catch((error) => {
        if (error.name === 'AbortError' || controller.signal.aborted) return;
        setState((s) => ({ data: s.data, error, loading: false }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled, refetchOnRefresh ? version : 0]);

  return { ...state, reload };
}
