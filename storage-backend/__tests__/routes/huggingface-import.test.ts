import Fastify, { FastifyInstance } from 'fastify';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import objectRoutes from '../../src/routes/api/objects/index';

const s3Mock = mockClient(S3Client);

jest.mock('../../src/utils/config', () => {
  const { S3Client } = require('@aws-sdk/client-s3');
  const client = new S3Client({ region: 'us-east-1' });
  return {
    getS3Config: () => ({
      accessKeyId: 'test',
      secretAccessKey: 'test',
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      defaultBucket: 'default',
      s3Client: client,
    }),
    getHFConfig: () => 'hf_test_token',
    getProxyConfig: () => ({ httpProxy: '', httpsProxy: '' }),
    getMaxFileSizeBytes: () => 20 * 1024 * 1024 * 1024,
    getMaxConcurrentTransfers: () => 2,
    getLocalStoragePaths: () => ['/tmp/test-storage'],
  };
});

jest.mock('../../src/utils/transferQueue', () => {
  const { TransferQueue } = jest.requireActual('../../src/utils/transferQueue');
  const queue = new TransferQueue(2);
  return {
    transferQueue: queue,
    TransferQueue,
    updateTransferQueueConcurrency: jest.fn(),
  };
});

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(objectRoutes, { prefix: '/api/objects' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  s3Mock.reset();
});

describe('POST /api/objects/huggingface-import', () => {
  it('returns 400 when modelId is missing', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('modelId');
  });

  it('returns 400 when destinationType is invalid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'test/model', destinationType: 'ftp' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('destinationType');
  });

  it('returns 400 when bucketName missing for S3 destination', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'test/model', destinationType: 's3' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('bucketName');
  });

  it('returns 400 when localLocationId missing for local destination', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'test/model', destinationType: 'local' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('localLocationId');
  });

  it('returns 400 for invalid modelId format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: '../../../etc/passwd', destinationType: 's3', bucketName: 'my-bucket' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('owner/model');
  });

  it('rejects modelId with path traversal characters', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'owner/model/../../secrets', destinationType: 's3', bucketName: 'my-bucket' },
    });
    expect(response.statusCode).toBe(400);
  });
});
