import http from 'http';
import express from 'express';

jest.mock('../src/utils/serviceDiscovery', () => ({
  resolveStorageBackend: jest.fn(),
  clearCache: jest.fn(),
}));

import { resolveStorageBackend } from '../src/utils/serviceDiscovery';
import { createStorageProxyRouter, closeProxy } from '../src/routes/storageProxy';
import { K8sHttpError } from '../src/utils/k8sClient';

const mockedResolve = jest.mocked(resolveStorageBackend);

function request(
  port: number,
  path: string,
  options: http.RequestOptions = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', ...options, headers: { ...options.headers } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    if (options.method === 'POST' && (options as any)._body) {
      req.write((options as any)._body);
    }
    req.end();
  });
}

describe('Storage Proxy', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let bffServer: http.Server;
  let bffPort: number;

  const TEST_POD_NAMESPACE = 'custom-ns';

  beforeAll((done) => {
    const target = express();
    target.use(express.json());

    target.get('/api/buckets', (_req, res) => {
      res.json({ buckets: ['bucket-1', 'bucket-2'] });
    });

    target.get('/api/objects/:bucket/:prefix', (req, res) => {
      res.json({
        bucket: req.params.bucket,
        prefix: req.params.prefix,
        query: req.query,
      });
    });

    target.post('/api/transfer', (req, res) => {
      res.json({ jobId: 'job-1', method: req.method });
    });

    target.delete('/api/objects/:bucket/:key', (req, res) => {
      res.json({ deleted: true, bucket: req.params.bucket });
    });

    target.get('/api/transfer/progress/:jobId', (_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.write('data: {"progress":50}\n\n');
      res.end();
    });

    target.get('/api/objects/download/:bucket/:key', (_req, res) => {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="test.bin"');
      res.end(Buffer.from([0x00, 0x01, 0x02, 0xff]));
    });

    target.get('/api/echo-headers', (req, res) => {
      res.json({ authorization: req.headers.authorization });
    });

    target.get('/api/echo-sensitive-headers', (req, res) => {
      res.json({
        'x-forwarded-for': req.headers['x-forwarded-for'] ?? null,
        'x-real-ip': req.headers['x-real-ip'] ?? null,
        'x-forwarded-host': req.headers['x-forwarded-host'] ?? null,
        'x-forwarded-proto': req.headers['x-forwarded-proto'] ?? null,
        'forwarded': req.headers['forwarded'] ?? null,
      });
    });

    targetServer = target.listen(0, () => {
      targetPort = (targetServer.address() as { port: number }).port;

      const bff = express();
      bff.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
      bff.get('/api/config', (_req, res) => res.json({ bffNamespace: TEST_POD_NAMESPACE }));
      bff.use('/api', createStorageProxyRouter());

      bffServer = bff.listen(0, () => {
        bffPort = (bffServer.address() as { port: number }).port;
        done();
      });
    });
  });

  afterAll((done) => {
    closeProxy();
    bffServer.close(() => targetServer.close(done));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolve.mockResolvedValue(`http://127.0.0.1:${targetPort}`);
  });

  describe('health endpoint', () => {
    it('responds independently of proxy', async () => {
      const res = await request(bffPort, '/healthz');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
      expect(mockedResolve).not.toHaveBeenCalled();
    });
  });

  describe('config endpoint', () => {
    it('returns the BFF namespace', async () => {
      const res = await request(bffPort, '/api/config');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ bffNamespace: TEST_POD_NAMESPACE });
      expect(mockedResolve).not.toHaveBeenCalled();
    });
  });

  describe('proxy routing', () => {
    it('proxies GET requests and strips namespace from path', async () => {
      const res = await request(bffPort, '/api/my-project/buckets');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        buckets: ['bucket-1', 'bucket-2'],
      });
      expect(mockedResolve).toHaveBeenCalledWith('my-project');
    });

    it('proxies nested paths correctly', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/objects/my-bucket/abc123',
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.bucket).toBe('my-bucket');
      expect(body.prefix).toBe('abc123');
    });

    it('preserves query parameters', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/objects/my-bucket/abc123?maxKeys=50&delimiter=%2F',
      );
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.query.maxKeys).toBe('50');
      expect(body.query.delimiter).toBe('/');
    });

    it('proxies POST requests', async () => {
      const res = await request(bffPort, '/api/my-project/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).method).toBe('POST');
    });

    it('proxies DELETE requests', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/objects/my-bucket/abc123',
        { method: 'DELETE' },
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).deleted).toBe(true);
    });
  });

  describe('header forwarding', () => {
    it('forwards Authorization header to the storage backend', async () => {
      const res = await request(bffPort, '/api/my-project/echo-headers', {
        headers: { Authorization: 'Bearer user-token-xyz' },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).authorization).toBe(
        'Bearer user-token-xyz',
      );
    });
  });

  describe('streaming support', () => {
    it('sets X-Accel-Buffering: no for SSE responses', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/transfer/progress/job-1',
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers['x-accel-buffering']).toBe('no');
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('data: {"progress":50}');
    });

    it('passes binary content through unchanged', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/objects/download/bucket/key',
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/octet-stream');
    });
  });

  describe('input validation', () => {
    it('rejects namespaces with uppercase letters', async () => {
      const res = await request(bffPort, '/api/MyProject/buckets');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Invalid namespace format.');
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('rejects namespaces with special characters', async () => {
      const res = await request(bffPort, '/api/ns@evil.com/buckets');
      expect(res.statusCode).toBe(400);
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('rejects namespaces starting with a hyphen', async () => {
      const res = await request(bffPort, '/api/-invalid/buckets');
      expect(res.statusCode).toBe(400);
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('rejects namespaces longer than 63 characters', async () => {
      const longNs = 'a'.repeat(64);
      const res = await request(bffPort, `/api/${longNs}/buckets`);
      expect(res.statusCode).toBe(400);
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('accepts valid K8s namespace names', async () => {
      const res = await request(bffPort, '/api/my-project-123/buckets');
      expect(res.statusCode).toBe(200);
      expect(mockedResolve).toHaveBeenCalledWith('my-project-123');
    });

    it('rejects paths containing dot-dot traversal', async () => {
      const res = await request(bffPort, '/api/my-project/../admin/config');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Invalid path.');
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('rejects URL-encoded dot-dot traversal (%2e%2e)', async () => {
      const res = await request(bffPort, '/api/my-project/%2e%2e/admin/config');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Invalid path.');
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('rejects mixed-case URL-encoded dot-dot traversal (%2E%2E)', async () => {
      const res = await request(bffPort, '/api/my-project/%2E%2E/admin/config');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Invalid path.');
      expect(mockedResolve).not.toHaveBeenCalled();
    });

    it('rejects malformed percent-encoding', async () => {
      const res = await request(bffPort, '/api/my-project/%GG/data');
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe('Invalid path.');
      expect(mockedResolve).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns 404 when service discovery reports not found', async () => {
      mockedResolve.mockRejectedValue(
        new K8sHttpError(404, '{"kind":"Status","message":"services \\"brewet-storage-backend\\" not found"}'),
      );
      const res = await request(bffPort, '/api/missing-ns/buckets');
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Storage backend not found');
      expect(body.detail).toContain('missing-ns');
    });

    it('returns 403 when service discovery reports access denied', async () => {
      mockedResolve.mockRejectedValue(
        new K8sHttpError(403, '{"kind":"Status","message":"forbidden"}'),
      );
      const res = await request(bffPort, '/api/restricted-ns/buckets');
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error).toBe('Access denied');
    });

    it('returns 503 when storage backend is unreachable', async () => {
      mockedResolve.mockResolvedValue('http://127.0.0.1:1');
      const res = await request(bffPort, '/api/my-project/buckets');
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).error).toBe(
        'Storage backend is unreachable',
      );
    });

    it('returns 502 with sanitized message for generic discovery errors', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockedResolve.mockRejectedValue(new Error('Network timeout'));
      const res = await request(bffPort, '/api/my-project/buckets');
      expect(res.statusCode).toBe(502);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Service discovery failed');
      expect(body.detail).not.toContain('Network timeout');
      expect(body.detail).toBe(
        'An internal error occurred during service discovery.',
      );
      spy.mockRestore();
    });
  });

  describe('header sanitization', () => {
    it('strips a spoofed x-real-ip header', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/echo-sensitive-headers',
        { headers: { 'x-real-ip': '10.0.0.1' } },
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)['x-real-ip']).toBeNull();
    });

    it('strips a spoofed x-forwarded-host header', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/echo-sensitive-headers',
        { headers: { 'x-forwarded-host': 'evil.example.com' } },
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)['x-forwarded-host']).toBeNull();
    });

    it('strips a spoofed x-forwarded-proto header', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/echo-sensitive-headers',
        { headers: { 'x-forwarded-proto': 'https' } },
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)['x-forwarded-proto']).toBeNull();
    });

    it('strips a spoofed forwarded header', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/echo-sensitive-headers',
        { headers: { forwarded: 'for=1.2.3.4;proto=http' } },
      );
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)['forwarded']).toBeNull();
    });

    it('overwrites a spoofed x-forwarded-for with the actual client IP', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/echo-sensitive-headers',
        { headers: { 'x-forwarded-for': '1.2.3.4' } },
      );
      expect(res.statusCode).toBe(200);
      const forwardedFor = JSON.parse(res.body)['x-forwarded-for'];
      // The proxy replaces the spoofed value with the real socket address.
      expect(forwardedFor).not.toBe('1.2.3.4');
      expect(forwardedFor).not.toBeNull();
    });

    it('sets x-forwarded-for to the loopback address for local test clients', async () => {
      const res = await request(
        bffPort,
        '/api/my-project/echo-sensitive-headers',
      );
      expect(res.statusCode).toBe(200);
      const forwardedFor = JSON.parse(res.body)['x-forwarded-for'];
      // In-process test clients connect via loopback.
      expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(forwardedFor);
    });
  });
});
