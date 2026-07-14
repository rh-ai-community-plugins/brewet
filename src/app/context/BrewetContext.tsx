import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export type ContainerStatus = 'none' | 'stopped' | 'running' | 'starting' | 'error';

export interface ContainerInfo {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  creationTimestamp?: string;
}

export interface BrewetContextValue {
  selectedProject: string | null;
  setSelectedProject: (project: string | null) => void;
  containerStatus: ContainerStatus;
  containerInfo: ContainerInfo | null;
  refreshContainerStatus: () => void;
}

const STORAGE_KEY = 'brewet.selected-project';

const BrewetContext = createContext<BrewetContextValue | undefined>(undefined);

export const BrewetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedProject, setSelectedProjectState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const [containerStatus, setContainerStatus] = useState<ContainerStatus>('none');
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setSelectedProject = useCallback((project: string | null) => {
    setSelectedProjectState(project);
    try {
      if (project) {
        localStorage.setItem(STORAGE_KEY, project);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const refreshContainerStatus = useCallback(() => {
    abortControllerRef.current?.abort();

    if (!selectedProject) {
      setContainerStatus('none');
      setContainerInfo(null);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    fetch(
      `/api/k8s/apis/apps/v1/namespaces/${encodeURIComponent(selectedProject)}/deployments/brewet-storage-backend`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (res.status === 404) {
          setContainerStatus('none');
          setContainerInfo(null);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to fetch container status: ${res.status}`);
        return res.json();
      })
      .then((deployment) => {
        if (!deployment) return;

        const name = deployment.metadata?.name;
        const namespace = deployment.metadata?.namespace;
        if (!name || !namespace) {
          throw new Error('Unexpected deployment response shape');
        }

        const replicas = deployment.spec?.replicas ?? 0;
        const readyReplicas = deployment.status?.readyReplicas ?? 0;

        setContainerInfo({
          name,
          namespace,
          replicas,
          readyReplicas,
          creationTimestamp: deployment.metadata?.creationTimestamp,
        });

        if (replicas === 0) {
          setContainerStatus('stopped');
        } else if (readyReplicas > 0) {
          setContainerStatus('running');
        } else {
          setContainerStatus('starting');
        }
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setContainerStatus('error');
        setContainerInfo(null);
      });
  }, [selectedProject]);

  useEffect(() => {
    refreshContainerStatus();
    return () => abortControllerRef.current?.abort();
  }, [refreshContainerStatus]);

  useEffect(() => {
    if (containerStatus !== 'starting') return;
    const intervalId = setInterval(refreshContainerStatus, 5000);
    return () => clearInterval(intervalId);
  }, [containerStatus, refreshContainerStatus]);

  return (
    <BrewetContext.Provider
      value={{
        selectedProject,
        setSelectedProject,
        containerStatus,
        containerInfo,
        refreshContainerStatus,
      }}
    >
      {children}
    </BrewetContext.Provider>
  );
};

export function useBrewetContext(): BrewetContextValue {
  const ctx = useContext(BrewetContext);
  if (!ctx) {
    throw new Error('useBrewetContext must be used within a BrewetProvider');
  }
  return ctx;
}
