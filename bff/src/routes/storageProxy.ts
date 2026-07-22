import httpProxy from 'http-proxy';
import { Router, Request, Response, NextFunction } from 'express';
import {
  resolveStorageBackend,
  clearCache,
} from '../utils/serviceDiscovery';
import { K8sHttpError } from '../utils/k8sClient';
import { rateLimiter } from '../middleware/rateLimiter';

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authentication required' });
    return;
  }
  next();
}

const K8S_NAMESPACE_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const proxy = httpProxy.createProxyServer({});

const SANITIZED_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
];

proxy.on('proxyReq', (proxyReq, req) => {
  for (const header of SANITIZED_HEADERS) {
    proxyReq.removeHeader(header);
  }
  const clientIp = (req as Request).ip || req.socket.remoteAddress;
  if (clientIp) {
    proxyReq.setHeader('x-forwarded-for', clientIp);
  }
});

proxy.on('proxyRes', (proxyRes, _req, res) => {
  const contentType = proxyRes.headers['content-type'] || '';
  if (contentType.includes('text/event-stream')) {
    (res as Response).setHeader('X-Accel-Buffering', 'no');
    (res as Response).setHeader('Cache-Control', 'no-cache');
    (res as Response).setHeader('Connection', 'keep-alive');
  }
});

function handleProxyError(
  err: NodeJS.ErrnoException,
  namespace: string,
  res: Response,
): void {
  clearCache(namespace);
  if (res.headersSent) return;

  const code = err.code;
  if (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND'
  ) {
    res.status(503).json({
      error: 'Storage backend is unreachable',
      detail: `The storage backend in namespace "${namespace}" is not running. Start the Brewet container first.`,
    });
  } else {
    console.error('Proxy error for namespace %s: %s', namespace, err.message);
    res.status(502).json({
      error: 'Proxy error',
      detail: 'An internal proxy error occurred.',
    });
  }
}

function handleDiscoveryError(err: Error, namespace: string, res: Response): void {
  if (res.headersSent) return;

  if (err instanceof K8sHttpError) {
    if (err.status === 404) {
      res.status(404).json({
        error: 'Storage backend not found',
        detail: `No Brewet storage backend found in namespace "${namespace}". Create a Brewet container first.`,
      });
    } else if (err.status === 403) {
      res.status(403).json({
        error: 'Access denied',
        detail: `The BFF service account does not have permission to access namespace "${namespace}".`,
      });
    } else {
      console.error('Service discovery error for namespace %s: K8s API returned %d', namespace, err.status);
      res.status(502).json({
        error: 'Service discovery failed',
        detail: 'An internal error occurred during service discovery.',
      });
    }
  } else {
    console.error('Service discovery error for namespace %s: %s', namespace, err.message);
    res.status(502).json({
      error: 'Service discovery failed',
      detail: 'An internal error occurred during service discovery.',
    });
  }
}

const PROXY_TIMEOUT_MS = 300_000;

export function createStorageProxyRouter(): Router {
  const router = Router();

  router.use('/:namespace', requireAuth, rateLimiter, (req: Request, res: Response) => {
    const namespace = req.params.namespace;
    const remainingPath = req.url;

    if (!K8S_NAMESPACE_RE.test(namespace)) {
      res.status(400).json({ error: 'Invalid namespace format.' });
      return;
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(remainingPath);
    } catch {
      res.status(400).json({ error: 'Invalid path.' });
      return;
    }
    if (decodedPath.includes('..')) {
      res.status(400).json({ error: 'Invalid path.' });
      return;
    }

    resolveStorageBackend(namespace)
      .then((target) => {
        req.url = '/api' + remainingPath;

        proxy.web(
          req,
          res,
          {
            target,
            changeOrigin: true,
            proxyTimeout: PROXY_TIMEOUT_MS,
            timeout: PROXY_TIMEOUT_MS,
          },
          (err) => handleProxyError(err as NodeJS.ErrnoException, namespace, res),
        );
      })
      .catch((err: Error) => handleDiscoveryError(err, namespace, res));
  });

  return router;
}

export { proxy };
