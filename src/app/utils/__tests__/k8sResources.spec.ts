import { buildDeployment, buildService, buildNetworkPolicy, buildSettingsSecret, defaultMountPath, validateMountPath, SETTINGS_SECRET_NAME } from '../k8sResources';
import { ContainerConfig } from '~/app/types/k8s';

describe('k8sResources', () => {
  describe('buildDeployment', () => {
    it('should build a deployment with no data connection and no PVCs', () => {
      const config: ContainerConfig = { dataConnection: null, pvcMounts: [] };
      const deployment = buildDeployment('test-ns', config);

      expect(deployment.kind).toBe('Deployment');
      expect(deployment.metadata.name).toBe('brewet-storage-backend');
      expect(deployment.metadata.namespace).toBe('test-ns');
      expect(deployment.spec.replicas).toBe(1);

      const container = deployment.spec.template.spec.containers[0];
      expect(container.envFrom).toEqual([{ secretRef: { name: SETTINGS_SECRET_NAME } }]);
      expect(container.volumeMounts).toEqual([]);
      expect(container.env).toEqual([]);
    });

    it('should include securityContext for OpenShift restricted SCC', () => {
      const config: ContainerConfig = { dataConnection: null, pvcMounts: [] };
      const deployment = buildDeployment('test-ns', config);

      expect(deployment.spec.template.spec.securityContext).toEqual({ runAsNonRoot: true });

      const container = deployment.spec.template.spec.containers[0];
      expect(container.securityContext).toEqual({
        allowPrivilegeEscalation: false,
        capabilities: { drop: ['ALL'] },
        seccompProfile: { type: 'RuntimeDefault' },
      });
    });

    it('should include envFrom when data connection is provided', () => {
      const config: ContainerConfig = {
        dataConnection: {
          metadata: { name: 'my-dc', namespace: 'test-ns' },
        },
        pvcMounts: [],
      };
      const deployment = buildDeployment('test-ns', config);
      const container = deployment.spec.template.spec.containers[0];

      expect(container.envFrom).toEqual([
        { secretRef: { name: 'my-dc' } },
        { secretRef: { name: SETTINGS_SECRET_NAME } },
      ]);
    });

    it('should include volume mounts and LOCAL_STORAGE_PATHS when PVCs are provided', () => {
      const config: ContainerConfig = {
        dataConnection: null,
        pvcMounts: [
          {
            pvc: { metadata: { name: 'data-pvc', namespace: 'test-ns' } },
            mountPath: '/mnt/data',
          },
          {
            pvc: { metadata: { name: 'models-pvc', namespace: 'test-ns' } },
            mountPath: '/mnt/models',
          },
        ],
      };
      const deployment = buildDeployment('test-ns', config);
      const container = deployment.spec.template.spec.containers[0];

      expect(deployment.spec.template.spec.volumes).toHaveLength(2);
      expect(container.volumeMounts).toHaveLength(2);
      expect(container.volumeMounts[0]).toEqual({ name: 'pvc-data-pvc', mountPath: '/mnt/data' });

      const localPaths = container.env.find((e: { name: string }) => e.name === 'LOCAL_STORAGE_PATHS');
      expect(localPaths?.value).toBe('/mnt/data,/mnt/models');
    });

    it('should use custom image when provided', () => {
      const config: ContainerConfig = { dataConnection: null, pvcMounts: [] };
      const deployment = buildDeployment('test-ns', config, 'custom:v1');
      expect(deployment.spec.template.spec.containers[0].image).toBe('custom:v1');
    });

    it('should not use the :latest tag by default', () => {
      const config: ContainerConfig = { dataConnection: null, pvcMounts: [] };
      const deployment = buildDeployment('test-ns', config);
      const image = deployment.spec.template.spec.containers[0].image as string;
      expect(image).toBeTruthy();
      expect(image).not.toMatch(/:latest$/);
    });
  });

  describe('buildService', () => {
    it('should build a ClusterIP service on port 8888', () => {
      const service = buildService('test-ns');

      expect(service.kind).toBe('Service');
      expect(service.metadata.name).toBe('brewet-storage-backend');
      expect(service.metadata.namespace).toBe('test-ns');
      expect(service.spec.type).toBe('ClusterIP');
      expect(service.spec.ports[0].port).toBe(8888);
    });
  });

  describe('buildNetworkPolicy', () => {
    it('should build a network policy restricting ingress to BFF namespace', () => {
      const np = buildNetworkPolicy('test-ns', 'cp-brewet');

      expect(np.kind).toBe('NetworkPolicy');
      expect(np.metadata.name).toBe('brewet-storage-backend-ingress');
      expect(np.spec.policyTypes).toEqual(['Ingress']);
      expect(np.spec.ingress[0].from[0].namespaceSelector.matchLabels).toEqual({
        'kubernetes.io/metadata.name': 'cp-brewet',
      });
      expect(np.spec.ingress[0].ports[0].port).toBe(8888);
    });
  });

  describe('defaultMountPath', () => {
    it('should return the default mount path for a PVC', () => {
      expect(defaultMountPath('my-pvc')).toBe('/opt/app-root/src/my-pvc');
    });
  });

  describe('validateMountPath', () => {
    it('should accept a valid absolute path', () => {
      expect(validateMountPath('/mnt/data', [])).toBeNull();
    });

    it('should reject an empty path', () => {
      expect(validateMountPath('', [])).toBe('Mount path is required');
    });

    it('should reject a relative path', () => {
      expect(validateMountPath('mnt/data', [])).toBe('Must be an absolute path starting with /');
    });

    it('should reject path traversal', () => {
      expect(validateMountPath('/mnt/../etc', [])).toBe('Path traversal (..) is not allowed');
    });

    it('should reject dangerous system paths', () => {
      expect(validateMountPath('/', [])).toBe('Cannot mount to a system directory');
      expect(validateMountPath('/etc', [])).toBe('Cannot mount to a system directory');
      expect(validateMountPath('/proc', [])).toBe('Cannot mount to a system directory');
    });

    it('should reject paths with invalid characters', () => {
      expect(validateMountPath('/mnt/da ta', [])).toBe('Path contains invalid characters');
    });

    it('should reject duplicate paths', () => {
      expect(validateMountPath('/mnt/data', ['/mnt/data'])).toBe('Duplicate mount path');
    });

    it('should accept unique valid paths', () => {
      expect(validateMountPath('/mnt/models', ['/mnt/data'])).toBeNull();
    });
  });

  describe('buildSettingsSecret', () => {
    it('should build a secret with default values when no settings provided', () => {
      const secret = buildSettingsSecret('test-ns');

      expect(secret.kind).toBe('Secret');
      expect(secret.metadata.name).toBe(SETTINGS_SECRET_NAME);
      expect(secret.metadata.namespace).toBe('test-ns');
      expect(secret.metadata.labels).toEqual({
        app: 'brewet-storage-backend',
        'app.kubernetes.io/part-of': 'brewet',
        'app.kubernetes.io/component': 'storage-backend',
      });
      expect(secret.stringData).toEqual({
        HF_TOKEN: '',
        HTTP_PROXY: '',
        HTTPS_PROXY: '',
        MAX_CONCURRENT_TRANSFERS: '2',
        MAX_FILES_PER_PAGE: '100',
        ALLOWED_FILE_EXTENSIONS: '',
        BLOCKED_FILE_EXTENSIONS: '',
      });
    });

    it('should build a secret with provided settings', () => {
      const secret = buildSettingsSecret('test-ns', {
        hfToken: 'hf_abc123',
        httpProxy: 'http://proxy:8080',
        httpsProxy: 'https://proxy:8443',
        maxConcurrentTransfers: 5,
        maxFilesPerPage: 50,
        allowedFileExtensions: '.py,.csv',
        blockedFileExtensions: '.exe,.dll',
      });

      expect(secret.stringData).toEqual({
        HF_TOKEN: 'hf_abc123',
        HTTP_PROXY: 'http://proxy:8080',
        HTTPS_PROXY: 'https://proxy:8443',
        MAX_CONCURRENT_TRANSFERS: '5',
        MAX_FILES_PER_PAGE: '50',
        ALLOWED_FILE_EXTENSIONS: '.py,.csv',
        BLOCKED_FILE_EXTENSIONS: '.exe,.dll',
      });
    });
  });
});
