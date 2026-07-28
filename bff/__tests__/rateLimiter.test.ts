import http from 'http';
import express from 'express';

jest.mock('../src/utils/serviceDiscovery', () => ({
  resolveStorageBackend: jest.fn(),
  clearCache: jest.fn(),
}));

import { resolveStorageBackend } from '../src/utils/serviceDiscovery';
import { createStorageProxyRouter, closeProxy } from '../src/routes/storageProxy';

const mockedResolve = jest.mocked(resolveStorageBackend);

function request(
  port: number,
  path: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET', headers: { Authorization: 'Bearer test-token' } },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Rate Limiter', () => {
  let targetServer: http.Server;
  let targetPort: number;
  let bffServer: http.Server;
  let bffPort: number;

  beforeAll((done) => {
    const target = express();
    target.get('/api/buckets', (_req, res) => {
      res.json({ buckets: [] });
    });

    targetServer = target.listen(0, () => {
      targetPort = (targetServer.address() as { port: number }).port;

      const bff = express();
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

  it('allows requests under the rate limit', async () => {
    const res = await request(bffPort, '/api/my-project/buckets');
    expect(res.statusCode).toBe(200);
  });

  it('includes draft-8 RateLimit header on successful responses', async () => {
    const res = await request(bffPort, '/api/my-project/buckets');
    expect(res.statusCode).toBe(200);
    // express-rate-limit with standardHeaders:'draft-8' emits a combined RateLimit header
    // e.g. '"100-in-1min"; r=99; t=60'
    expect(res.headers['ratelimit']).toBeDefined();
  });

  it('includes RateLimit-Policy header on successful responses', async () => {
    const res = await request(bffPort, '/api/my-project/buckets');
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-policy']).toBeDefined();
  });

  it('does not include legacy X-RateLimit-* headers', async () => {
    const res = await request(bffPort, '/api/my-project/buckets');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
  });
});
