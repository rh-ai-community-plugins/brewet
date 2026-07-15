import { useState, useCallback, useRef, useEffect } from 'react';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { ContainerConfig } from '~/app/types/k8s';
import { buildDeployment, buildService, buildNetworkPolicy } from '~/app/utils/k8sResources';

const DEPLOYMENT_NAME = 'brewet-storage-backend';
const BFF_NAMESPACE = 'brewet';

interface CreateResourceResult {
  resource: string;
  success: boolean;
  error?: string;
}

export function useBrewetContainer() {
  const {
    selectedProject,
    containerStatus,
    containerInfo,
    refreshContainerStatus,
  } = useBrewetContext();

  const [isActioning, setIsActioning] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scaleReplicas = useCallback(
    async (replicas: number) => {
      if (!selectedProject) return;

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsActioning(true);

      try {
        const res = await fetch(
          `/api/k8s/apis/apps/v1/namespaces/${encodeURIComponent(selectedProject)}/deployments/${DEPLOYMENT_NAME}/scale`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              apiVersion: 'autoscaling/v1',
              kind: 'Scale',
              metadata: { name: DEPLOYMENT_NAME, namespace: selectedProject },
              spec: { replicas },
            }),
            signal: controller.signal,
          },
        );
        if (!res.ok) throw new Error(`Scale request failed: ${res.status}`);
        timerRef.current = setTimeout(refreshContainerStatus, 1000);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Scale operation failed:', err);
        refreshContainerStatus();
      } finally {
        setIsActioning(false);
      }
    },
    [selectedProject, refreshContainerStatus],
  );

  const startContainer = useCallback(() => scaleReplicas(1), [scaleReplicas]);
  const stopContainer = useCallback(() => scaleReplicas(0), [scaleReplicas]);

  const deleteContainer = useCallback(async () => {
    if (!selectedProject) return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsActioning(true);

    const ns = encodeURIComponent(selectedProject);
    const resources = [
      { name: 'NetworkPolicy', url: `/api/k8s/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies/${DEPLOYMENT_NAME}-ingress` },
      { name: 'Service', url: `/api/k8s/api/v1/namespaces/${ns}/services/${DEPLOYMENT_NAME}` },
      { name: 'Deployment', url: `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments/${DEPLOYMENT_NAME}` },
    ];

    try {
      for (const { url } of resources) {
        const res = await fetch(url, {
          method: 'DELETE',
          signal: controller.signal,
        });
        if (!res.ok && res.status !== 404) {
          throw new Error(`Delete failed: ${res.status}`);
        }
      }
      timerRef.current = setTimeout(refreshContainerStatus, 1000);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      console.error('Delete operation failed:', err);
      refreshContainerStatus();
    } finally {
      setIsActioning(false);
    }
  }, [selectedProject, refreshContainerStatus]);

  const createContainer = useCallback(
    async (config: ContainerConfig): Promise<CreateResourceResult[]> => {
      if (!selectedProject) return [];

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsActioning(true);

      const ns = encodeURIComponent(selectedProject);
      const results: CreateResourceResult[] = [];

      const resourceSpecs = [
        {
          name: 'Deployment',
          url: `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments`,
          body: buildDeployment(selectedProject, config),
        },
        {
          name: 'Service',
          url: `/api/k8s/api/v1/namespaces/${ns}/services`,
          body: buildService(selectedProject),
        },
        {
          name: 'NetworkPolicy',
          url: `/api/k8s/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`,
          body: buildNetworkPolicy(selectedProject, BFF_NAMESPACE),
        },
      ];

      try {
        for (const { name, url, body } of resourceSpecs) {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            results.push({ resource: name, success: false, error: `${res.status}: ${text}` });
          } else {
            results.push({ resource: name, success: true });
          }
        }
        timerRef.current = setTimeout(refreshContainerStatus, 1000);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return results;
        console.error('Create operation failed:', err);
        refreshContainerStatus();
      } finally {
        setIsActioning(false);
      }

      return results;
    },
    [selectedProject, refreshContainerStatus],
  );

  const updateContainer = useCallback(
    async (config: ContainerConfig): Promise<CreateResourceResult[]> => {
      if (!selectedProject) return [];

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsActioning(true);

      const ns = encodeURIComponent(selectedProject);
      const results: CreateResourceResult[] = [];

      const deployment = buildDeployment(selectedProject, config);

      try {
        const res = await fetch(
          `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments/${DEPLOYMENT_NAME}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deployment),
            signal: controller.signal,
          },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          results.push({ resource: 'Deployment', success: false, error: `${res.status}: ${text}` });
        } else {
          results.push({ resource: 'Deployment', success: true });
        }
        timerRef.current = setTimeout(refreshContainerStatus, 1000);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return results;
        console.error('Update operation failed:', err);
        refreshContainerStatus();
      } finally {
        setIsActioning(false);
      }

      return results;
    },
    [selectedProject, refreshContainerStatus],
  );

  return {
    selectedProject,
    containerStatus,
    containerInfo,
    isActioning,
    startContainer,
    stopContainer,
    deleteContainer,
    createContainer,
    updateContainer,
    refreshContainerStatus,
  };
}
