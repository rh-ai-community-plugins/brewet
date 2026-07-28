import { useState, useEffect, useCallback, useRef } from 'react';
import { PersistentVolumeClaim } from '~/app/types/k8s';

export function usePVCs(namespace: string | null) {
  const [pvcs, setPvcs] = useState<PersistentVolumeClaim[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    controllerRef.current?.abort();

    if (!namespace) {
      setPvcs([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    fetch(
      `/api/k8s/api/v1/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch PVCs: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setPvcs(data.items ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        setError(e.message);
        setLoading(false);
      });
  }, [namespace]);

  useEffect(() => {
    refresh();
    return () => controllerRef.current?.abort();
  }, [refresh]);

  return { pvcs, loading, error, refresh };
}
