import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

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
    if (!selectedProject) {
      setContainerStatus('none');
      setContainerInfo(null);
      return;
    }

    fetch(
      `/api/k8s/apis/apps/v1/namespaces/${encodeURIComponent(selectedProject)}/deployments/brewet-storage-backend`,
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
        const replicas = deployment.spec?.replicas ?? 0;
        const readyReplicas = deployment.status?.readyReplicas ?? 0;

        const info: ContainerInfo = {
          name: deployment.metadata.name,
          namespace: deployment.metadata.namespace,
          replicas,
          readyReplicas,
          creationTimestamp: deployment.metadata.creationTimestamp,
        };
        setContainerInfo(info);

        if (replicas === 0) {
          setContainerStatus('stopped');
        } else if (readyReplicas > 0) {
          setContainerStatus('running');
        } else {
          setContainerStatus('starting');
        }
      })
      .catch(() => {
        setContainerStatus('error');
        setContainerInfo(null);
      });
  }, [selectedProject]);

  useEffect(() => {
    refreshContainerStatus();
  }, [refreshContainerStatus]);

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
