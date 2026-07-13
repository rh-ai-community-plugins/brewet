import express from 'express';
import { namespaceSummaryHandler } from './routes/namespaceSummary';
import { getK8sBaseUrl } from './utils/k8sClient';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/namespace-summary', namespaceSummaryHandler);

app.listen(PORT, () => {
  try {
    const baseUrl = getK8sBaseUrl();
    console.log(`BFF listening on port ${PORT}`);
    console.log(`K8s API target: ${baseUrl}`);
  } catch {
    console.error(`BFF listening on port ${PORT}`);
    console.error('WARNING: K8s API is not configured. Set K8S_API_BASE or run in-cluster.');
    console.error('  Example: K8S_API_BASE=$(oc whoami --show-server) npm run start:dev');
    console.error('  All API requests will fail with 502 until this is set.');
  }
});

export default app;
