import { ContainerConfig } from '~/app/types/k8s';

export const DEPLOYMENT_NAME = 'brewet-storage-backend';
const SERVICE_PORT = 8888;
const CONTAINER_IMAGE_DEFAULT =
  process.env.STORAGE_BACKEND_IMAGE ||
  'quay.io/OWNER/brewet-storage-backend:0.1.0';
const DEFAULT_MOUNT_PREFIX = '/opt/app-root/src';

const DANGEROUS_PATHS = ['/', '/etc', '/proc', '/sys', '/dev', '/var', '/tmp', '/root', '/home'];

export function validateMountPath(path: string, existingPaths: string[]): string | null {
  if (!path) return 'Mount path is required';
  if (!path.startsWith('/')) return 'Must be an absolute path starting with /';
  if (/\.\./.test(path)) return 'Path traversal (..) is not allowed';
  if (DANGEROUS_PATHS.includes(path)) return 'Cannot mount to a system directory';
  if (!/^\/[a-zA-Z0-9._\-/]+$/.test(path)) return 'Path contains invalid characters';
  if (existingPaths.includes(path)) return 'Duplicate mount path';
  return null;
}

export function buildDeployment(
  namespace: string,
  config: ContainerConfig,
  image = CONTAINER_IMAGE_DEFAULT,
) {
  const volumes: Array<{ name: string; persistentVolumeClaim: { claimName: string } }> = [];
  const volumeMounts: Array<{ name: string; mountPath: string }> = [];
  const localStoragePaths: string[] = [];

  config.pvcMounts.forEach(({ pvc, mountPath }) => {
    const pvcName = pvc.metadata.name;
    const volName = `pvc-${pvcName}`.slice(0, 63);
    volumes.push({ name: volName, persistentVolumeClaim: { claimName: pvcName } });
    volumeMounts.push({ name: volName, mountPath });
    localStoragePaths.push(mountPath);
  });

  const env: Array<{ name: string; value: string }> = [];
  if (localStoragePaths.length > 0) {
    env.push({ name: 'LOCAL_STORAGE_PATHS', value: localStoragePaths.join(',') });
  }

  const envFrom: Array<{ secretRef: { name: string } }> = [];
  if (config.dataConnection) {
    envFrom.push({ secretRef: { name: config.dataConnection.metadata.name } });
  }

  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: DEPLOYMENT_NAME,
      namespace,
      labels: {
        app: DEPLOYMENT_NAME,
        'app.kubernetes.io/part-of': 'brewet',
      },
    },
    spec: {
      replicas: 1,
      selector: {
        matchLabels: { app: DEPLOYMENT_NAME },
      },
      template: {
        metadata: {
          labels: { app: DEPLOYMENT_NAME },
        },
        spec: {
          securityContext: {
            runAsNonRoot: true,
          },
          containers: [
            {
              name: 'storage-backend',
              image,
              ports: [{ containerPort: SERVICE_PORT, protocol: 'TCP' }],
              env,
              envFrom,
              volumeMounts,
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
              },
            },
          ],
          volumes,
        },
      },
    },
  };
}

export function buildService(namespace: string) {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: DEPLOYMENT_NAME,
      namespace,
      labels: {
        app: DEPLOYMENT_NAME,
        'app.kubernetes.io/part-of': 'brewet',
      },
    },
    spec: {
      selector: { app: DEPLOYMENT_NAME },
      ports: [
        {
          port: SERVICE_PORT,
          targetPort: SERVICE_PORT,
          protocol: 'TCP',
        },
      ],
      type: 'ClusterIP',
    },
  };
}

export function buildNetworkPolicy(namespace: string, bffNamespace: string) {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: `${DEPLOYMENT_NAME}-ingress`,
      namespace,
      labels: {
        app: DEPLOYMENT_NAME,
        'app.kubernetes.io/part-of': 'brewet',
      },
    },
    spec: {
      podSelector: {
        matchLabels: { app: DEPLOYMENT_NAME },
      },
      policyTypes: ['Ingress'],
      ingress: [
        {
          from: [
            {
              namespaceSelector: {
                matchLabels: {
                  'kubernetes.io/metadata.name': bffNamespace,
                },
              },
            },
          ],
          ports: [{ port: SERVICE_PORT, protocol: 'TCP' }],
        },
      ],
    },
  };
}

export function defaultMountPath(pvcName: string): string {
  return `${DEFAULT_MOUNT_PREFIX}/${pvcName}`;
}
