import httpProxy from 'http-proxy';
import { Router, Request, Response } from 'express';
import {
  resolveStorageBackend,
  clearCache,
} from '../utils/serviceDiscovery';

const proxy = httpProxy.createProxyServer({});

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
    res.status(502).json({
      error: 'Proxy error',
      detail: err.message,
    });
  }
}

function handleDiscoveryError(err: Error, namespace: string, res: Response): void {
  if (res.headersSent) return;

  if (err.message.includes('404')) {
    res.status(404).json({
      error: 'Storage backend not found',
      detail: `No Brewet storage backend found in namespace "${namespace}". Create a Brewet container first.`,
    });
  } else if (err.message.includes('403')) {
    res.status(403).json({
      error: 'Access denied',
      detail: `The BFF service account does not have permission to access namespace "${namespace}".`,
    });
  } else {
    res.status(502).json({
      error: 'Service discovery failed',
      detail: err.message,
    });
  }
}

const PROXY_TIMEOUT_MS = 300_000;

export function createStorageProxyRouter(): Router {
  const router = Router();

  router.use('/:namespace', (req: Request, res: Response) => {
    const namespace = req.params.namespace;
    const remainingPath = req.url;

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
