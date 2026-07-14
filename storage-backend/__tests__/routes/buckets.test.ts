import Fastify, { FastifyInstance } from 'fastify';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  ListBucketsCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import bucketRoutes from '../../src/routes/api/buckets/index';

const s3Mock = mockClient(S3Client);

// Mock the config module to return our mocked S3 client
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
  };
});

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(bucketRoutes, { prefix: '/api/buckets' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  s3Mock.reset();
});

describe('GET /api/buckets', () => {
  it('lists accessible buckets', async () => {
    s3Mock.on(ListBucketsCommand).resolves({
      Owner: { DisplayName: 'testuser' },
      Buckets: [
        { Name: 'bucket-1', CreationDate: new Date() },
        { Name: 'bucket-2', CreationDate: new Date() },
      ],
    });
    s3Mock.on(HeadBucketCommand).resolves({});

    const response = await app.inject({ method: 'GET', url: '/api/buckets' });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.buckets).toHaveLength(2);
    expect(body.defaultBucket).toBe('default');
  });

  it('filters out inaccessible buckets', async () => {
    s3Mock.on(ListBucketsCommand).resolves({
      Buckets: [
        { Name: 'accessible', CreationDate: new Date() },
        { Name: 'forbidden', CreationDate: new Date() },
      ],
    });
    s3Mock.on(HeadBucketCommand, { Bucket: 'accessible' }).resolves({});
    s3Mock.on(HeadBucketCommand, { Bucket: 'forbidden' }).rejects(new Error('Forbidden'));

    const response = await app.inject({ method: 'GET', url: '/api/buckets' });
    const body = JSON.parse(response.body);
    expect(body.buckets).toHaveLength(1);
    expect(body.buckets[0].Name).toBe('accessible');
  });
});

describe('POST /api/buckets', () => {
  it('creates a bucket with valid name', async () => {
    s3Mock.on(CreateBucketCommand).resolves({});

    const response = await app.inject({
      method: 'POST',
      url: '/api/buckets',
      payload: { bucketName: 'new-bucket' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('Bucket created successfully');
  });

  it('rejects invalid bucket name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/buckets',
      payload: { bucketName: 'AB' },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('InvalidBucketName');
  });
});

describe('DELETE /api/buckets/:bucketName', () => {
  it('deletes a bucket', async () => {
    s3Mock.on(DeleteBucketCommand).resolves({});

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/buckets/my-bucket',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('Bucket deleted successfully');
  });
});
