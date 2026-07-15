import { useState, useEffect, useCallback, useRef } from 'react';
import { DataConnection } from '~/app/types/k8s';

export function useDataConnections(namespace: string | null) {
  const [dataConnections, setDataConnections] = useState<DataConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(() => {
    controllerRef.current?.abort();

    if (!namespace) {
      setDataConnections([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    setError(null);

    const labelSelector = encodeURIComponent('opendatahub.io/dashboard=true');
    fetch(
      `/api/k8s/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets?labelSelector=${labelSelector}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch data connections: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const s3Connections = (data.items ?? []).filter((secret: DataConnection) => {
          const connType = secret.metadata.annotations?.['opendatahub.io/connection-type'];
          return connType === 's3';
        });
        setDataConnections(s3Connections);
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

  return { dataConnections, loading, error, refresh };
}
