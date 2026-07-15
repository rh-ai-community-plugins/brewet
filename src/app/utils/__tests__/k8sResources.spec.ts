import { buildDeployment, buildService, buildNetworkPolicy, defaultMountPath } from '../k8sResources';
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
      expect(container.envFrom).toEqual([]);
      expect(container.volumeMounts).toEqual([]);
      expect(container.env).toEqual([]);
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

      expect(container.envFrom).toEqual([{ secretRef: { name: 'my-dc' } }]);
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
      const np = buildNetworkPolicy('test-ns', 'brewet');

      expect(np.kind).toBe('NetworkPolicy');
      expect(np.metadata.name).toBe('brewet-storage-backend-ingress');
      expect(np.spec.policyTypes).toEqual(['Ingress']);
      expect(np.spec.ingress[0].from[0].namespaceSelector.matchLabels).toEqual({
        'kubernetes.io/metadata.name': 'brewet',
      });
      expect(np.spec.ingress[0].ports[0].port).toBe(8888);
    });
  });

  describe('defaultMountPath', () => {
    it('should return the default mount path for a PVC', () => {
      expect(defaultMountPath('my-pvc')).toBe('/opt/app-root/src/my-pvc');
    });
  });
});
