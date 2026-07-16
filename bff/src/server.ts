import express from 'express';
import { getK8sBaseUrl } from './utils/k8sClient';
import { createStorageProxyRouter } from './routes/storageProxy';
import { setupGracefulShutdown } from './shutdown';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

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
