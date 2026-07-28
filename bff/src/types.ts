export interface K8sMetadata {
  name: string;
  namespace?: string;
  [key: string]: unknown;
}

export interface K8sResource {
  metadata: K8sMetadata;
  status?: { phase?: string; [key: string]: unknown };
  [key: string]: unknown;
}

export interface K8sList {
  items: K8sResource[];
}
