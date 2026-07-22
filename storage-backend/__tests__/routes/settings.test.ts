import Fastify, { FastifyInstance } from 'fastify';
import settingsRoutes from '../../src/routes/api/settings/index';

jest.mock('../../src/utils/config', () => ({
  getS3Config: () => ({
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    region: 'us-east-1',
    endpoint: 'http://localhost:9000',
    defaultBucket: 'test-bucket',
  }),
  updateS3Config: jest.fn(),
  getHFConfig: () => 'test-hf-token',
  updateHFConfig: jest.fn(),
  getMaxConcurrentTransfers: () => 3,
  updateMaxConcurrentTransfers: jest.fn(),
  getMaxFilesPerPage: () => 100,
  updateMaxFilesPerPage: jest.fn(),
  getProxyConfig: () => ({ httpProxy: '', httpsProxy: '' }),
  updateProxyConfig: jest.fn(),
}));

jest.mock('../../src/utils/transferQueue', () => ({
  updateTransferQueueConcurrency: jest.fn(),
}));

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(settingsRoutes, { prefix: '/api/settings' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PUT /api/settings/s3', () => {
  const validS3Payload = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    endpoint: 'https://s3.amazonaws.com',
    defaultBucket: 'my-bucket',
  };

  it('updates S3 settings with a valid external endpoint', async () => {
    const { updateS3Config } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/s3',
      payload: validS3Payload,
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ message: 'Settings updated successfully' });
    expect(updateS3Config).toHaveBeenCalled();
  });

  it('rejects endpoint pointing to localhost', async () => {
    const { updateS3Config } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/s3',
      payload: { ...validS3Payload, endpoint: 'http://localhost:9000' },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('Endpoint URL points to a blocked address');
    expect(updateS3Config).not.toHaveBeenCalled();
  });

  it('rejects endpoint pointing to private IP (10.x)', async () => {
    const { updateS3Config } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/s3',
      payload: { ...validS3Payload, endpoint: 'http://10.0.0.1:9000' },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('Endpoint URL points to a blocked address');
    expect(updateS3Config).not.toHaveBeenCalled();
  });

  it('rejects endpoint pointing to 169.254 (link-local / metadata)', async () => {
    const { updateS3Config } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/s3',
      payload: { ...validS3Payload, endpoint: 'http://169.254.169.254/latest/meta-data/' },
    });
    expect(response.statusCode).toBe(400);
    expect(updateS3Config).not.toHaveBeenCalled();
  });

  it('rejects endpoint pointing to Kubernetes internal service', async () => {
    const { updateS3Config } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/s3',
      payload: { ...validS3Payload, endpoint: 'http://my-service.default.svc.cluster.local:9000' },
    });
    expect(response.statusCode).toBe(400);
    expect(updateS3Config).not.toHaveBeenCalled();
  });
});

describe('PUT /api/settings/proxy', () => {
  it('updates proxy settings with valid external URLs', async () => {
    const { updateProxyConfig } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/proxy',
      payload: { httpProxy: 'http://proxy.example.com:8080', httpsProxy: 'https://proxy.example.com:8443' },
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ message: 'Settings updated successfully' });
    expect(updateProxyConfig).toHaveBeenCalled();
  });

  it('rejects httpProxy pointing to localhost', async () => {
    const { updateProxyConfig } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/proxy',
      payload: { httpProxy: 'http://localhost:8080' },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('httpProxy points to a blocked address');
    expect(updateProxyConfig).not.toHaveBeenCalled();
  });

  it('rejects httpsProxy pointing to private IP (192.168.x)', async () => {
    const { updateProxyConfig } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/proxy',
      payload: { httpsProxy: 'https://192.168.1.1:3128' },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('httpsProxy points to a blocked address');
    expect(updateProxyConfig).not.toHaveBeenCalled();
  });

  it('rejects httpProxy pointing to Kubernetes internal service', async () => {
    const { updateProxyConfig } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/proxy',
      payload: { httpProxy: 'http://proxy.kube-system.svc.cluster.local:3128' },
    });
    expect(response.statusCode).toBe(400);
    expect(updateProxyConfig).not.toHaveBeenCalled();
  });

  it('allows clearing proxy settings with empty strings', async () => {
    const { updateProxyConfig } = require('../../src/utils/config');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/proxy',
      payload: { httpProxy: '', httpsProxy: '' },
    });
    expect(response.statusCode).toBe(200);
    expect(updateProxyConfig).toHaveBeenCalledWith('', '');
  });
});

describe('GET /api/settings/max-concurrent-transfers', () => {
  it('returns the current max concurrent transfers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/settings/max-concurrent-transfers',
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ maxConcurrentTransfers: 3 });
  });
});

describe('PUT /api/settings/max-concurrent-transfers', () => {
  it('updates config and live transfer queue concurrency', async () => {
    const { updateMaxConcurrentTransfers } = require('../../src/utils/config');
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');

    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 5 },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ message: 'Settings updated successfully' });
    expect(updateMaxConcurrentTransfers).toHaveBeenCalledWith(5);
    expect(updateTransferQueueConcurrency).toHaveBeenCalledWith(5);
  });

  it('calls updateTransferQueueConcurrency with the same value as updateMaxConcurrentTransfers', async () => {
    const { updateMaxConcurrentTransfers } = require('../../src/utils/config');
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');

    await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 10 },
    });

    expect(updateMaxConcurrentTransfers).toHaveBeenCalledWith(10);
    expect(updateTransferQueueConcurrency).toHaveBeenCalledWith(10);
  });

  it('returns 400 for value below minimum (0)', async () => {
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 0 },
    });
    expect(response.statusCode).toBe(400);
    expect(updateTransferQueueConcurrency).not.toHaveBeenCalled();
  });

  it('returns 400 for value above maximum (21)', async () => {
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 21 },
    });
    expect(response.statusCode).toBe(400);
    expect(updateTransferQueueConcurrency).not.toHaveBeenCalled();
  });

  it('returns 400 for non-numeric value', async () => {
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 'five' },
    });
    expect(response.statusCode).toBe(400);
    expect(updateTransferQueueConcurrency).not.toHaveBeenCalled();
  });

  it('returns 400 for missing body', async () => {
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(updateTransferQueueConcurrency).not.toHaveBeenCalled();
  });

  it('accepts boundary value 1', async () => {
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 1 },
    });
    expect(response.statusCode).toBe(200);
    expect(updateTransferQueueConcurrency).toHaveBeenCalledWith(1);
  });

  it('accepts boundary value 20', async () => {
    const { updateTransferQueueConcurrency } = require('../../src/utils/transferQueue');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/settings/max-concurrent-transfers',
      payload: { maxConcurrentTransfers: 20 },
    });
    expect(response.statusCode).toBe(200);
    expect(updateTransferQueueConcurrency).toHaveBeenCalledWith(20);
  });
});
