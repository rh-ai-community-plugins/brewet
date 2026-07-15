import { useState, useEffect, useRef } from 'react';

interface AlertState {
  variant: 'success' | 'danger';
  title: string;
  message?: string;
}

interface UseSettingsTabResult<T> {
  data: T;
  setData: React.Dispatch<React.SetStateAction<T>>;
  loading: boolean;
  alert: AlertState | null;
  setAlert: React.Dispatch<React.SetStateAction<AlertState | null>>;
  mountedRef: React.MutableRefObject<boolean>;
}

export function useSettingsTab<T>(
  loadFn: (namespace: string, signal: AbortSignal) => Promise<T>,
  namespace: string,
  initialValue: T,
  errorTitle: string,
): UseSettingsTabResult<T> {
  const [data, setData] = useState<T>(initialValue);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const mountedRef = useRef(true);
  const loadFnRef = useRef(loadFn);
  const errorTitleRef = useRef(errorTitle);
  loadFnRef.current = loadFn;
  errorTitleRef.current = errorTitle;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setAlert(null);
      try {
        const result = await loadFnRef.current(namespace, controller.signal);
        if (!mountedRef.current) return;
        setData(result);
      } catch (err) {
        if (!mountedRef.current || (err as Error).name === 'AbortError') return;
        setAlert({ variant: 'danger', title: errorTitleRef.current, message: (err as Error).message });
      } finally {
        if (mountedRef.current && !controller.signal.aborted) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [namespace]);

  return { data, setData, loading, alert, setAlert, mountedRef };
}

export type { AlertState };
