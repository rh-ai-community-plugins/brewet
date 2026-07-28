import { useCallback, useRef, useEffect } from 'react';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { ContainerConfig } from '~/app/types/k8s';
import {
  buildDeployment,
  buildService,
  buildNetworkPolicy,
  buildSettingsSecret,
  DEPLOYMENT_NAME,
  SETTINGS_SECRET_NAME,
} from '~/app/utils/k8sResources';

const BFF_NAMESPACE = process.env.BFF_NAMESPACE ?? 'cp-brewet';

export interface CreateResourceResult {
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
    isActioning,
    setIsActioning,
  } = useBrewetContext();

  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(refreshContainerStatus, 1000);
  }, [refreshContainerStatus]);

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
        scheduleRefresh();
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('Scale operation failed:', err);
        refreshContainerStatus();
      } finally {
        setIsActioning(false);
      }
    },
    [selectedProject, refreshContainerStatus, scheduleRefresh, setIsActioning],
  );

  const startContainer = useCallback(() => scaleReplicas(1), [scaleReplicas]);
  const stopContainer = useCallback(() => scaleReplicas(0), [scaleReplicas]);

  const deleteContainer = useCallback(async (): Promise<boolean> => {
    if (!selectedProject) return false;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsActioning(true);

    const ns = encodeURIComponent(selectedProject);
    const resources = [
      { name: 'NetworkPolicy', url: `/api/k8s/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies/${DEPLOYMENT_NAME}-ingress` },
      { name: 'Service', url: `/api/k8s/api/v1/namespaces/${ns}/services/${DEPLOYMENT_NAME}` },
      { name: 'Deployment', url: `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments/${DEPLOYMENT_NAME}` },
      { name: 'Secret', url: `/api/k8s/api/v1/namespaces/${ns}/secrets/${SETTINGS_SECRET_NAME}` },
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
      scheduleRefresh();
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return false;
      console.error('Delete operation failed:', err);
      refreshContainerStatus();
      return false;
    } finally {
      setIsActioning(false);
    }
  }, [selectedProject, refreshContainerStatus, scheduleRefresh, setIsActioning]);

  const createContainer = useCallback(
    async (config: ContainerConfig): Promise<CreateResourceResult[]> => {
      if (!selectedProject) return [];

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setIsActioning(true);

      const ns = encodeURIComponent(selectedProject);
      const results: CreateResourceResult[] = [];
      const createdUrls: string[] = [];

      const resourceSpecs = [
        {
          name: 'Secret',
          createUrl: `/api/k8s/api/v1/namespaces/${ns}/secrets`,
          deleteUrl: `/api/k8s/api/v1/namespaces/${ns}/secrets/${SETTINGS_SECRET_NAME}`,
          body: buildSettingsSecret(selectedProject, config.settings),
        },
        {
          name: 'Deployment',
          createUrl: `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments`,
          deleteUrl: `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments/${DEPLOYMENT_NAME}`,
          body: buildDeployment(selectedProject, config),
        },
        {
          name: 'Service',
          createUrl: `/api/k8s/api/v1/namespaces/${ns}/services`,
          deleteUrl: `/api/k8s/api/v1/namespaces/${ns}/services/${DEPLOYMENT_NAME}`,
          body: buildService(selectedProject),
        },
        {
          name: 'NetworkPolicy',
          createUrl: `/api/k8s/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`,
          deleteUrl: `/api/k8s/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies/${DEPLOYMENT_NAME}-ingress`,
          body: buildNetworkPolicy(selectedProject, BFF_NAMESPACE),
        },
      ];

      try {
        for (const { name, createUrl, deleteUrl, body } of resourceSpecs) {
          let res = await fetch(createUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (res.status === 409) {
            res = await fetch(deleteUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
          }
          if (!res.ok) {
            const text = await res.text().catch(() => '');
            results.push({ resource: name, success: false, error: `${res.status}: ${text}` });
            // Rollback previously created resources (no signal — must not be cancellable)
            for (const url of createdUrls.reverse()) {
              await fetch(url, { method: 'DELETE' }).catch(() => {});
            }
            break;
          }
          results.push({ resource: name, success: true });
          createdUrls.push(deleteUrl);
        }
        if (results.every((r) => r.success)) {
          scheduleRefresh();
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          results.push({ resource: 'Operation', success: false, error: 'Aborted' });
          for (const url of [...createdUrls].reverse()) {
            await fetch(url, { method: 'DELETE' }).catch(() => {});
          }
          return results;
        }
        console.error('Create operation failed:', err);
        // Best-effort rollback
        for (const url of createdUrls.reverse()) {
          await fetch(url, { method: 'DELETE' }).catch(() => {});
        }
        refreshContainerStatus();
      } finally {
        setIsActioning(false);
      }

      return results;
    },
    [selectedProject, refreshContainerStatus, scheduleRefresh, setIsActioning],
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
      const settingsSecret = buildSettingsSecret(selectedProject, config.settings);

      try {
        const secretRes = await fetch(
          `/api/k8s/api/v1/namespaces/${ns}/secrets/${SETTINGS_SECRET_NAME}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingsSecret),
            signal: controller.signal,
          },
        );
        if (!secretRes.ok) {
          const text = await secretRes.text().catch(() => '');
          results.push({ resource: 'Secret', success: false, error: `${secretRes.status}: ${text}` });
        } else {
          results.push({ resource: 'Secret', success: true });
        }

        if (results.every((r) => r.success)) {
          const deployUrl = `/api/k8s/apis/apps/v1/namespaces/${ns}/deployments/${DEPLOYMENT_NAME}`;
          const getRes = await fetch(deployUrl, { signal: controller.signal });
          if (!getRes.ok) {
            const text = await getRes.text().catch(() => '');
            results.push({ resource: 'Deployment', success: false, error: `${getRes.status}: ${text}` });
          } else {
            const current = await getRes.json();
            const updated = {
              ...deployment,
              metadata: { ...deployment.metadata, resourceVersion: current.metadata.resourceVersion as string },
            };
            const res = await fetch(deployUrl, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updated),
              signal: controller.signal,
            });
            if (!res.ok) {
              const text = await res.text().catch(() => '');
              results.push({ resource: 'Deployment', success: false, error: `${res.status}: ${text}` });
            } else {
              results.push({ resource: 'Deployment', success: true });
            }
          }
        }

        if (results.every((r) => r.success)) {
          scheduleRefresh();
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return results;
        console.error('Update operation failed:', err);
        refreshContainerStatus();
      } finally {
        setIsActioning(false);
      }

      return results;
    },
    [selectedProject, refreshContainerStatus, scheduleRefresh, setIsActioning],
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
