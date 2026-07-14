import http from 'http';
import express from 'express';

jest.mock('../src/utils/serviceDiscovery', () => ({
  resolveStorageBackend: jest.fn(),
  clearCache: jest.fn(),
}));

import { resolveStorageBackend } from '../src/utils/serviceDiscovery';
import { createStorageProxyRouter, proxy } from '../src/routes/storageProxy';

const mockedResolve = jest.mocked(resolveStorageBackend);

function request(
  port: number,
  path: string,
  options: http.RequestOptions = {},
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', ...options },
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

    targetServer = target.listen(0, () => {
      targetPort = (targetServer.address() as { port: number }).port;

      const bff = express();
      bff.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
      bff.use('/api', createStorageProxyRouter());

      bffServer = bff.listen(0, () => {
        bffPort = (bffServer.address() as { port: number }).port;
        done();
      });
    });
  });

  afterAll((done) => {
    proxy.close();
    bffServer.close(() => targetServer.close(done));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedResolve.mockResolvedValue(`http://127.0.0.1:${targetPort}`);
  });

  describe('health endpoint', () => {
    it('responds independently of proxy', async () => {
      const res = await request(bffPort, '/api/health');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: 'ok' });
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

  describe('error handling', () => {
    it('returns 404 when service discovery reports not found', async () => {
      mockedResolve.mockRejectedValue(
        new Error('K8s API returned 404: not found'),
      );
      const res = await request(bffPort, '/api/missing-ns/buckets');
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('Storage backend not found');
      expect(body.detail).toContain('missing-ns');
    });

    it('returns 403 when service discovery reports access denied', async () => {
      mockedResolve.mockRejectedValue(
        new Error('K8s API returned 403: forbidden'),
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

    it('returns 502 for generic service discovery errors', async () => {
      mockedResolve.mockRejectedValue(new Error('Network timeout'));
      const res = await request(bffPort, '/api/my-project/buckets');
      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body).error).toBe('Service discovery failed');
    });
  });
});
