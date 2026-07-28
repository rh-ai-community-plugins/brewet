import https from 'https';
import fs from 'fs';

export class K8sHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`K8s API returned ${status}`);
    this.name = 'K8sHttpError';
    this.status = status;
    this.body = body;
  }
}

const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
let cachedCa: Buffer | undefined;
try {
  cachedCa = fs.readFileSync(CA_PATH);
} catch {
  // Not running in-cluster or CA file not available
}

export function getK8sBaseUrl(): string {
  if (process.env.K8S_API_BASE) {
    return process.env.K8S_API_BASE;
  }
  const host = process.env.KUBERNETES_SERVICE_HOST;
  const port = process.env.KUBERNETES_SERVICE_PORT;
  if (host && port) {
    return `https://${host}:${port}`;
  }
  throw new Error(
    'K8s API not configured: set K8S_API_BASE or run in-cluster',
  );
}

export function k8sRequest<T = unknown>(token: string, path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const baseUrl = getK8sBaseUrl();
    const url = new URL(path, baseUrl);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    };

    const skipTls = process.env.K8S_TLS_SKIP_VERIFY === 'true';
    if (skipTls) {
      console.warn(
        'WARNING: TLS certificate verification is disabled — do not use in production',
      );
      options.rejectUnauthorized = false;
    } else if (cachedCa) {
      options.ca = cachedCa;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('Failed to parse response JSON'));
          }
        } else {
          reject(
            new K8sHttpError(res.statusCode || 500, data),
          );
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}
