import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useProjects, Project } from '~/app/hooks/useProjects';
import { useFavoriteProjects } from '~/app/hooks/useFavoriteProjects';
import { storageService } from '~/app/services/storageService';

export type ContainerStatus = 'none' | 'stopped' | 'running' | 'starting' | 'error';

export interface ContainerInfo {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  creationTimestamp?: string;
  env?: Array<{ name: string; value: string }>;
  envFrom?: Array<{ secretRef: { name: string } }>;
  volumes?: Array<{ name: string; persistentVolumeClaim?: { claimName: string } }>;
  volumeMounts?: Array<{ name: string; mountPath: string }>;
}

export interface BrewetContextValue {
  selectedProject: string | null;
  setSelectedProject: (project: string | null) => void;
  projects: Project[];
  projectsLoading: boolean;
  projectsError: string | null;
  refreshProjects: () => void;
  addProject: (project: Project) => void;
  containerStatus: ContainerStatus;
  containerInfo: ContainerInfo | null;
  refreshContainerStatus: () => void;
  isActioning: boolean;
  setIsActioning: (value: boolean) => void;
}

const STORAGE_KEY = 'brewet.selected-project';
const MAX_START_POLLS = 60; // 60 × 5 s = 5 minutes

type K8sCondition = { type: string; status: string; reason?: string };

const BrewetContext = createContext<BrewetContextValue | undefined>(undefined);

export const BrewetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedProject, setSelectedProjectState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const { projects, loading: projectsLoading, error: projectsError, refresh: refreshProjects, addProject } = useProjects();
  const { favorites } = useFavoriteProjects();
  const location = useLocation();
  const selectedProjectRef = useRef(selectedProject);
  selectedProjectRef.current = selectedProject;
  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;

  const refreshAndValidate = useCallback(() => {
    refreshProjects().then((freshProjects) => {
      if (freshProjects.length === 0) return;
      const projectNames = freshProjects.map((p) => p.metadata.name);
      if (selectedProjectRef.current && projectNames.includes(selectedProjectRef.current)) return;

      const favoriteMatch = favoritesRef.current.find((f) => projectNames.includes(f));
      const fallback = favoriteMatch ?? projectNames.sort((a, b) => a.localeCompare(b))[0] ?? null;
      setSelectedProjectState(fallback);
      try {
        if (fallback) {
          localStorage.setItem(STORAGE_KEY, fallback);
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // localStorage unavailable
      }
    });
  }, [refreshProjects]);

  useEffect(() => {
    refreshAndValidate();
  }, [location.pathname, refreshAndValidate]);

  useEffect(() => {
    const onFocus = () => refreshAndValidate();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshAndValidate]);

  const [containerStatus, setContainerStatus] = useState<ContainerStatus>('none');
  const [containerInfo, setContainerInfo] = useState<ContainerInfo | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollCountRef = useRef(0);

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
        if (!res.ok) throw new Error(`Failed to fetch Brewet status: ${res.status}`);
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

        const containers: Array<{
          env?: Array<{ name: string; value: string }>;
          envFrom?: Array<{ secretRef: { name: string } }>;
          volumeMounts?: Array<{ name: string; mountPath: string }>;
        }> = deployment.spec?.template?.spec?.containers ?? [];
        const primaryContainer = containers[0] ?? {};

        setContainerInfo({
          name,
          namespace,
          replicas,
          readyReplicas,
          creationTimestamp: deployment.metadata?.creationTimestamp,
          env: primaryContainer.env ?? [],
          envFrom: primaryContainer.envFrom ?? [],
          volumes: deployment.spec?.template?.spec?.volumes ?? [],
          volumeMounts: primaryContainer.volumeMounts ?? [],
        });

        const conditions: K8sCondition[] = deployment.status?.conditions ?? [];
        const isDeploymentFailed = conditions.some(
          (c) =>
            (c.type === 'Progressing' && c.status === 'False' && c.reason === 'ProgressDeadlineExceeded') ||
            (c.type === 'ReplicaFailure' && c.status === 'True'),
        );

        if (replicas === 0) {
          setContainerStatus('stopped');
        } else if (readyReplicas > 0) {
          setContainerStatus('running');
        } else if (isDeploymentFailed) {
          setContainerStatus('error');
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
    if (containerStatus !== 'starting') {
      pollCountRef.current = 0;
      return;
    }
    const intervalId = setInterval(() => {
      if (pollCountRef.current >= MAX_START_POLLS) {
        setContainerStatus('error');
        return;
      }
      pollCountRef.current += 1;
      refreshContainerStatus();
    }, 5000);
    return () => clearInterval(intervalId);
  }, [containerStatus, refreshContainerStatus]);

  const prevStatusRef = useRef<ContainerStatus>('none');
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = containerStatus;
    if (containerStatus !== 'running' || prev === 'running' || !selectedProject) return;

    storageService.readSettingsSecret(selectedProject).then((s) => {
      const promises: Promise<unknown>[] = [
        storageService.updateProxySettings(selectedProject, {
          httpProxy: s.httpProxy ?? '',
          httpsProxy: s.httpsProxy ?? '',
        }),
        storageService.updateHuggingFaceSettings(selectedProject, {
          hfToken: s.hfToken ?? '',
        }),
        storageService.updateMaxConcurrentTransfers(
          selectedProject,
          s.maxConcurrentTransfers ?? 2,
        ),
        storageService.updateMaxFilesPerPage(
          selectedProject,
          s.maxFilesPerPage ?? 100,
        ),
      ];
      if (s.allowedFileExtensions || s.blockedFileExtensions) {
        const allowed = s.allowedFileExtensions
          ? s.allowedFileExtensions.split(',').map((e) => e.trim()).filter(Boolean)
          : [];
        const blocked = s.blockedFileExtensions
          ? s.blockedFileExtensions.split(',').map((e) => e.trim()).filter(Boolean)
          : [];
        if (allowed.length > 0 || blocked.length > 0) {
          promises.push(
            storageService.updateFileExtensions(selectedProject, {
              allowedExtensions: allowed,
              blockedExtensions: blocked,
            }),
          );
        }
      }
      Promise.all(promises).catch(() => {});
    }).catch(() => {});
  }, [containerStatus, selectedProject]);

  const contextValue = useMemo(
    () => ({
      selectedProject,
      setSelectedProject,
      projects,
      projectsLoading,
      projectsError,
      refreshProjects: refreshAndValidate,
      addProject,
      containerStatus,
      containerInfo,
      refreshContainerStatus,
      isActioning,
      setIsActioning,
    }),
    [selectedProject, setSelectedProject, projects, projectsLoading, projectsError, refreshAndValidate, addProject, containerStatus, containerInfo, refreshContainerStatus, isActioning],
  );

  return <BrewetContext.Provider value={contextValue}>{children}</BrewetContext.Provider>;
};

export function useBrewetContext(): BrewetContextValue {
  const ctx = useContext(BrewetContext);
  if (!ctx) {
    throw new Error('useBrewetContext must be used within a BrewetProvider');
  }
  return ctx;
}
