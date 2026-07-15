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
      bff.set('trust proxy', false);
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

  it('allows requests under the rate limit', async () => {
    const res = await request(bffPort, '/api/my-project/buckets');
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeDefined();
  });

  it('includes standard rate limit headers', async () => {
    const res = await request(bffPort, '/api/my-project/buckets');
    expect(res.statusCode).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });
});
