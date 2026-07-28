import fs from 'fs';
import { k8sRequest } from './k8sClient';
import { K8S_NAMESPACE_RE } from './constants';

const SA_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const SERVICE_NAME = 'brewet-storage-backend';
const SERVICE_PORT = 8888;
const DEFAULT_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string>>();
const cacheTtlMs = (() => {
  const parsed = parseInt(process.env.SERVICE_CACHE_TTL_MS || '', 10);
  return Number.isNaN(parsed) ? DEFAULT_CACHE_TTL_MS : Math.max(0, parsed);
})();

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

async function doResolve(namespace: string): Promise<string> {
  const token = getServiceAccountToken();
  const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${SERVICE_NAME}`;

  await k8sRequest(token, path);

  const url = `http://${SERVICE_NAME}.${namespace}.svc.cluster.local:${SERVICE_PORT}`;
  cache.set(namespace, { url, expiresAt: Date.now() + cacheTtlMs });
  return url;
}

export async function resolveStorageBackend(
  namespace: string,
): Promise<string> {
  if (!K8S_NAMESPACE_RE.test(namespace)) {
    throw new Error(`Invalid namespace: ${namespace}`);
  }

  if (process.env.STORAGE_BACKEND_URL) {
    return process.env.STORAGE_BACKEND_URL;
  }

  const cached = cache.get(namespace);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const existing = inflight.get(namespace);
  if (existing) return existing;

  const promise = doResolve(namespace);
  inflight.set(namespace, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(namespace);
  }
}

export function clearCache(namespace?: string): void {
  if (namespace) {
    cache.delete(namespace);
  } else {
    cache.clear();
  }
}

export { SERVICE_NAME, SERVICE_PORT, DEFAULT_CACHE_TTL_MS };
