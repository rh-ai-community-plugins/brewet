import Fastify, { FastifyInstance } from 'fastify';
import { promises as fsPromises } from 'fs';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  PutObjectCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import transferRoutes from '../../src/routes/api/transfer/index';
import { transferQueue } from '../../src/utils/transferQueue';

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

  it('uses CopyObjectCommand for S3→S3 files exactly at the 5 GB boundary', async () => {
    const fiveGB = 5 * 1024 * 1024 * 1024;
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: fiveGB });
    s3Mock.on(CopyObjectCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'large-model.safetensors', type: 'file' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.jobId).toBeDefined();

    // Wait for the transfer job to run
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBeGreaterThan(0);
    expect(s3Mock.commandCalls(CreateMultipartUploadCommand).length).toBe(0);
  });

  it('uses multipart copy for S3→S3 files larger than 5 GB', async () => {
    const sixGB = 6 * 1024 * 1024 * 1024;
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: sixGB });
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: 'test-upload-id' });
    s3Mock.on(UploadPartCopyCommand).resolves({
      CopyPartResult: { ETag: '"abc123"' },
    });
    s3Mock.on(CompleteMultipartUploadCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'huge-model.safetensors', type: 'file' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.jobId).toBeDefined();

    // Wait for the transfer job to run
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(s3Mock.commandCalls(CopyObjectCommand).length).toBe(0);
    expect(s3Mock.commandCalls(CreateMultipartUploadCommand).length).toBeGreaterThan(0);
    // ceil(6 GB / 500 MB) = ceil(12.288) = 13 parts
    expect(s3Mock.commandCalls(UploadPartCopyCommand).length).toBe(13);
    expect(s3Mock.commandCalls(CompleteMultipartUploadCommand).length).toBeGreaterThan(0);
  });

  it('aborts multipart upload when S3→S3 transfer of large file fails mid-copy', async () => {
    const sixGB = 6 * 1024 * 1024 * 1024;
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: sixGB });
    s3Mock.on(CreateMultipartUploadCommand).resolves({ UploadId: 'abort-upload-id' });
    // Fail on the second part
    let partCount = 0;
    s3Mock.on(UploadPartCopyCommand).callsFake(() => {
      partCount++;
      if (partCount >= 2) throw new Error('S3 network error');
      return Promise.resolve({ CopyPartResult: { ETag: '"part1"' } });
    });
    s3Mock.on(AbortMultipartUploadCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/output',
        items: [{ path: 'huge-model.safetensors', type: 'file' }],
      },
    });

    expect(response.statusCode).toBe(200);

    // Wait for the async job to execute and fail (error is non-retryable so it fails immediately)
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(s3Mock.commandCalls(AbortMultipartUploadCommand).length).toBeGreaterThan(0);
    const abortCall = s3Mock.commandCalls(AbortMultipartUploadCommand)[0];
    expect(abortCall.args[0].input.UploadId).toBe('abort-upload-id');
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

  it('returns 400 for active job', async () => {
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    s3Mock.on(CopyObjectCommand).callsFake(() => new Promise(() => {}));

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/transfer',
      payload: {
        source: 's3:source-bucket/',
        destination: 's3:dest-bucket/out',
        items: [{ path: 'file.txt', type: 'file' }],
      },
    });
    const { jobId } = JSON.parse(createResponse.body);

    const response = await app.inject({
      method: 'POST',
      url: `/api/transfer/${jobId}/cleanup`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('cleans up cancelled job with no completed files', async () => {
    jest.spyOn(transferQueue, 'getJob').mockReturnValueOnce({
      id: 'cancelled-job-id',
      type: 'cross-storage',
      status: 'cancelled',
      files: [
        { sourcePath: 'src/data.txt', destinationPath: 'data.txt', size: 100, status: 'cancelled', loaded: 0 },
      ],
      abortController: new AbortController(),
      createdAt: Date.now(),
      completedAt: Date.now(),
      destination: { type: 's3', locationId: 'dest-bucket', basePath: 'output' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/cancelled-job-id/cleanup',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.cleaned).toBe(0);
    expect(body.errors).toBe(0);
  });

  it('deletes local files during cleanup', async () => {
    const testDir = '/tmp/test-storage';
    const testFile = `${testDir}/cleanup-test-${Date.now()}.txt`;
    await fsPromises.mkdir(testDir, { recursive: true });
    await fsPromises.writeFile(testFile, 'test content');

    const fileName = testFile.replace(`${testDir}/`, '');

    jest.spyOn(transferQueue, 'getJob').mockReturnValueOnce({
      id: 'local-cleanup-job',
      type: 'local-upload',
      status: 'failed',
      files: [
        { sourcePath: `src/${fileName}`, destinationPath: fileName, size: 12, status: 'completed', loaded: 12 },
      ],
      abortController: new AbortController(),
      createdAt: Date.now(),
      completedAt: Date.now(),
      destination: { type: 'local', locationId: 'local-0', basePath: '' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/local-cleanup-job/cleanup',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.cleaned).toBe(1);
    expect(body.errors).toBe(0);

    await expect(fsPromises.access(testFile)).rejects.toThrow();
  });

  it('deletes completed files during cleanup of failed job', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});

    jest.spyOn(transferQueue, 'getJob').mockReturnValueOnce({
      id: 'failed-job-id',
      type: 'cross-storage',
      status: 'failed',
      files: [
        { sourcePath: 'src/report.txt', destinationPath: 'report.txt', size: 100, status: 'completed', loaded: 100 },
        { sourcePath: 'src/pending.txt', destinationPath: 'pending.txt', size: 50, status: 'cancelled', loaded: 0 },
      ],
      abortController: new AbortController(),
      createdAt: Date.now(),
      completedAt: Date.now(),
      destination: { type: 's3', locationId: 'dest-bucket', basePath: 'output' },
    });

    const deleteCallsBefore = s3Mock.commandCalls(DeleteObjectCommand).length;

    const response = await app.inject({
      method: 'POST',
      url: '/api/transfer/failed-job-id/cleanup',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.cleaned).toBe(1);
    expect(body.errors).toBe(0);

    const deleteCallsAfter = s3Mock.commandCalls(DeleteObjectCommand).length;
    expect(deleteCallsAfter - deleteCallsBefore).toBe(1);
  });
});
