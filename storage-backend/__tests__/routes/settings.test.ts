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
