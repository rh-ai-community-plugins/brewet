import express from 'express';
import { getK8sBaseUrl } from './utils/k8sClient';
import { createStorageProxyRouter } from './routes/storageProxy';
import { setupGracefulShutdown } from './shutdown';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Trust the first reverse proxy (OpenShift router / ingress) so that
// req.ip returns the real client IP instead of the proxy's address.
app.set('trust proxy', 1);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    // Log method + route pattern instead of the full originalUrl, which may
    // contain base64-encoded file paths or other sensitive path segments.
    const routePattern = req.route?.path ?? req.path;
    console.log(`${req.method} ${routePattern} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));

app.use('/api', createStorageProxyRouter());

const server = app.listen(PORT, () => {
  const hasBackendOverride = !!process.env.STORAGE_BACKEND_URL;

  try {
    const baseUrl = getK8sBaseUrl();
    console.log(`BFF listening on port ${PORT}`);
    console.log(`K8s API target: ${baseUrl}`);
  } catch {
    console.log(`BFF listening on port ${PORT}`);

    if (hasBackendOverride) {
      console.log(
        `Storage backend override: ${process.env.STORAGE_BACKEND_URL}`,
      );
      console.log(
        'Service discovery is disabled (STORAGE_BACKEND_URL is set).',
      );
    } else {
      console.warn(
        'WARNING: K8s API is not configured. Set K8S_API_BASE or run in-cluster.',
      );
      console.warn(
        '  For local dev: K8S_API_BASE=$(oc whoami --show-server) npm run start:dev',
      );
      console.warn(
        '  Or set STORAGE_BACKEND_URL=http://localhost:8888 to skip service discovery.',
      );
      console.warn('  All API requests will fail until this is configured.');
    }
  }
});

setupGracefulShutdown(server);

export default app;
