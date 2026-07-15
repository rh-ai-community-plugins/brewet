export interface K8sMetadata {
  name: string;
  namespace: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

export interface DataConnection {
  metadata: K8sMetadata;
  data?: Record<string, string>;
}

export interface PersistentVolumeClaim {
  metadata: K8sMetadata;
  spec?: {
    accessModes?: string[];
    resources?: {
      requests?: {
        storage?: string;
      };
    };
    storageClassName?: string;
    volumeMode?: string;
  };
  status?: {
    phase?: string;
    capacity?: {
      storage?: string;
    };
  };
}

export interface ContainerConfig {
  dataConnection: DataConnection | null;
  pvcMounts: PvcMount[];
}

export interface PvcMount {
  pvc: PersistentVolumeClaim;
  mountPath: string;
}
