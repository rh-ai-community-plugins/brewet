import fs from 'fs';
import { k8sRequest } from './k8sClient';

const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SERVICE_NAME = 'brewet-storage-backend';
const SERVICE_PORT = 8888;
const DEFAULT_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const cacheTtlMs =
  Math.max(0, parseInt(process.env.SERVICE_CACHE_TTL_MS || '', 10)) ||
  DEFAULT_CACHE_TTL_MS;

function getServiceAccountToken(): string {
  if (process.env.K8S_SA_TOKEN) {
    return process.env.K8S_SA_TOKEN;
  }

  try {
    return fs.readFileSync(SA_TOKEN_PATH, 'utf8').trim();
  } catch {
    throw new Error(
      'ServiceAccount token not available. Set K8S_SA_TOKEN or run in-cluster.',
    );
  }
}

export async function resolveStorageBackend(
  namespace: string,
): Promise<string> {
  if (process.env.STORAGE_BACKEND_URL) {
    return process.env.STORAGE_BACKEND_URL;
  }

  const cached = cache.get(namespace);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const token = getServiceAccountToken();
  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${SERVICE_NAME}`;

  await k8sRequest(token, path);

  const url = `http://${SERVICE_NAME}.${namespace}.svc.cluster.local:${SERVICE_PORT}`;
  cache.set(namespace, { url, expiresAt: Date.now() + cacheTtlMs });
  return url;
}

export function clearCache(namespace?: string): void {
  if (namespace) {
    cache.delete(namespace);
  } else {
    cache.clear();
  }
}

export { SERVICE_NAME, SERVICE_PORT, DEFAULT_CACHE_TTL_MS };
