import Fastify, { FastifyInstance } from 'fastify';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import transferRoutes from '../../src/routes/api/transfer/index';

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
    getMaxConcurrentTransfers: () => 2,
    getMaxFileSizeBytes: () => 20 * 1024 * 1024 * 1024,
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
  app.register(transferRoutes, { prefix: '/api/transfer' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  s3Mock.reset();
});

describe('POST /api/transfer', () => {
  it('returns 400 when missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for invalid transfer path format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 'invalid-no-colon',
        destination: 's3:dest-bucket/path',
        items: [{ path: 'file.txt', type: 'file' }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 400 for invalid bucket name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:AB/path',
        destination: 's3:dest-bucket/path',
        items: [{ path: 'file.txt', type: 'file' }],
      },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('InvalidBucketName');
  });

  it('initiates S3→S3 transfer successfully', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(PutObjectCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/prefix',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'file.txt', type: 'file' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.jobId).toBeDefined();
    expect(body.sseUrl).toContain('/api/transfer/progress/');
    expect(body.fileCount).toBe(1);
  });

  it('expands directories for S3 source', async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'data/subdir/file1.txt', Size: 100 },
        { Key: 'data/subdir/file2.txt', Size: 200 },
      ],
      IsTruncated: false,
    });
    s3Mock.on(CopyObjectCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'data/subdir', type: 'directory' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.fileCount).toBe(2);
  });
});

describe('GET /api/transfer/:jobId', () => {
  it('returns 404 for nonexistent job', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/transfer/nonexistent',
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns job details for existing job', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 100 });
    s3Mock.on(CopyObjectCommand).resolves({});

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/',
        items: [{ path: 'test.txt', type: 'file' }],
      },
    });
    const { jobId } = JSON.parse(createResponse.body);

    // Wait briefly for the job to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    const response = await app.inject({
      method: 'GET',
      url: `/api/transfer/${jobId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.jobId).toBe(jobId);
    expect(body.totalFiles).toBe(1);
  });
});

describe('DELETE /api/transfer/:jobId', () => {
  it('returns 404 for nonexistent job', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/transfer/nonexistent',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/transfer/check-conflicts', () => {
  it('returns 400 when missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/check-conflicts',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('detects conflicts at S3 destination', async () => {
    s3Mock.on(HeadObjectCommand, { Bucket: 'source-bucket' }).resolves({ ContentLength: 500 });
    s3Mock.on(HeadObjectCommand, { Bucket: 'dest-bucket', Key: 'output/report.txt' }).resolves({ ContentLength: 200 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/check-conflicts',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'report.txt', type: 'file' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].path).toBe('report.txt');
    expect(body.conflicts[0].sourceSize).toBe(500);
    expect(body.conflicts[0].destinationSize).toBe(200);
  });

  it('reports no conflicts when destination is clear', async () => {
    s3Mock.on(HeadObjectCommand, { Bucket: 'source-bucket' }).resolves({ ContentLength: 500 });
    s3Mock.on(HeadObjectCommand, { Bucket: 'dest-bucket' }).rejects(new Error('NotFound'));

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/check-conflicts',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'new-file.txt', type: 'file' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.conflicts).toHaveLength(0);
    expect(body.nonConflicting).toHaveLength(1);
  });
});

describe('POST /api/transfer/:jobId/cleanup', () => {
  it('returns 404 for nonexistent job', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/nonexistent/cleanup',
    });
    expect(response.statusCode).toBe(404);
  });
});
