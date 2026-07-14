import Fastify, { FastifyInstance } from 'fastify';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client } from '@aws-sdk/client-s3';
import https from 'https';
import { EventEmitter } from 'events';
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

  it('rejects modelId where owner segment contains dots that allow traversal (e.g. ../gated-model)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: '../gated-model', destinationType: 's3', bucketName: 'my-bucket' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('owner/model');
  });

  it('rejects modelId where owner segment is a dot-only segment (e.g. ../owner/model)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: '..owner/model', destinationType: 's3', bucketName: 'my-bucket' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('owner/model');
  });

  it('rejects modelId where model segment is ".." (e.g. owner/..)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'owner/..', destinationType: 's3', bucketName: 'my-bucket' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('owner/model');
  });

  it('rejects modelId where model segment is "." (e.g. owner/.)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'owner/.', destinationType: 's3', bucketName: 'my-bucket' },
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('owner/model');
  });

  it('accepts valid modelId where owner has no dots but model segment may contain dots', async () => {
    // This tests that the regex does NOT block legitimate model names like "owner/model-v1.0"
    // We only check the validation path here; the HF network call will fail in test, so we
    // accept any non-400-from-validation status (the request proceeds past validation).
    const response = await app.inject({
      method: 'POST',
      url: '/api/objects/huggingface-import',
      payload: { modelId: 'valid-owner/model-v1.0', destinationType: 's3', bucketName: 'my-bucket' },
    });
    // A 400 here would mean our validation incorrectly rejects a valid modelId format.
    expect(response.statusCode).not.toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Helpers for socket-drain tests
  // ---------------------------------------------------------------------------

  /** Build a minimal IncomingMessage-like EventEmitter with a jest-spied resume(). */
  function makeMockResponse(statusCode: number, headers: Record<string, string> = {}) {
    const res = new EventEmitter() as any;
    res.statusCode = statusCode;
    res.headers = headers;
    res.resume = jest.fn();
    return res;
  }

  /** Build a minimal ClientRequest-like EventEmitter whose end() triggers the response callback. */
  function makeMockRequest(responseCallback: (res: any) => void, mockRes: any) {
    const req = new EventEmitter() as any;
    req.end = jest.fn(() => {
      // Invoke synchronously so Promise resolution stays predictable in tests
      responseCallback(mockRes);
    });
    return req;
  }

  // ---------------------------------------------------------------------------
  // Socket-drain tests for redirect and error branches
  // ---------------------------------------------------------------------------

  describe('redirect and error response body draining', () => {
    let httpsRequestSpy: jest.SpyInstance | undefined;
    let queueJobSpy: jest.SpyInstance | undefined;

    afterEach(() => {
      httpsRequestSpy?.mockRestore();
      httpsRequestSpy = undefined;
      queueJobSpy?.mockRestore();
      queueJobSpy = undefined;
    });

    it('fetchJSON calls res.resume() on a redirect response before following it', async () => {
      const redirectResumeSpy = jest.fn();
      let callCount = 0;

      const mockImpl = (_opts: any, responseCallback: any) => {
        const callIndex = callCount++;
        if (callIndex === 0) {
          // First call: 302 redirect to a follow-up HF URL
          const redirectRes = makeMockResponse(302, {
            location: 'https://huggingface.co/api/models/test/model-v2',
          });
          redirectRes.resume = redirectResumeSpy;
          return makeMockRequest(responseCallback, redirectRes);
        }
        // Second call (after redirect): 200 with model info (no files)
        const finalRes = makeMockResponse(200);
        const req = makeMockRequest(responseCallback, finalRes);
        // Emit the JSON body on next tick so the data/end listeners are attached first
        const originalEnd = req.end.getMockImplementation() ?? (() => {});
        req.end = jest.fn(() => {
          originalEnd();
          process.nextTick(() => {
            finalRes.emit('data', Buffer.from(JSON.stringify({ siblings: [], gated: false })));
            finalRes.emit('end');
          });
        });
        return req;
      };
      httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation(mockImpl as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'test/model', destinationType: 's3', bucketName: 'my-bucket' },
      });

      // resume() must have been called exactly once on the redirect response
      expect(redirectResumeSpy).toHaveBeenCalledTimes(1);
      // Empty siblings → route returns 200 with fileCount 0 (job queued, no files to transfer)
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).fileCount).toBe(0);
    });

    it('fetchJSON calls res.resume() on a redirect to a blocked host before rejecting', async () => {
      const redirectResumeSpy = jest.fn();

      const mockImpl = (_opts: any, responseCallback: any) => {
        const redirectRes = makeMockResponse(302, {
          location: 'http://169.254.169.254/metadata',
        });
        redirectRes.resume = redirectResumeSpy;
        return makeMockRequest(responseCallback, redirectRes);
      };
      httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation(mockImpl as any);

      // The blocked redirect causes fetchJSON (the initial model-info fetch) to reject,
      // so the route returns 500.
      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'test/model', destinationType: 's3', bucketName: 'my-bucket' },
      });

      expect(redirectResumeSpy).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(500);
    });

    it('fetchJSON calls res.resume() on a 4xx error response before rejecting', async () => {
      const errorResumeSpy = jest.fn();

      const mockImpl = (_opts: any, responseCallback: any) => {
        const errorRes = makeMockResponse(403);
        errorRes.resume = errorResumeSpy;
        return makeMockRequest(responseCallback, errorRes);
      };
      httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation(mockImpl as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'test/model', destinationType: 's3', bucketName: 'my-bucket' },
      });

      expect(errorResumeSpy).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(500);
    });

    it('downloadFile calls res.resume() on a redirect response before following it', async () => {
      const downloadRedirectResumeSpy = jest.fn();
      let callCount = 0;

      // Intercept queueJob so we can capture the executor and invoke it directly,
      // rather than waiting for the background queue to process it. This lets us
      // exercise downloadFile's redirect path synchronously in the test.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { transferQueue: mockedQueue } = require('../../src/utils/transferQueue');
      let capturedExecutor: ((...args: any[]) => Promise<void>) | null = null;
      let capturedFiles: any[] = [];
      queueJobSpy = jest
        .spyOn(mockedQueue, 'queueJob')
        .mockImplementation((_type: any, files: any, executor: any): string => {
          capturedExecutor = executor;
          capturedFiles = files;
          return 'test-download-hf-job-id';
        });

      const mockImpl = (_opts: any, responseCallback: any) => {
        const callIndex = callCount++;
        if (callIndex === 0) {
          // First call: model info fetch returns 200 with one file in the repository
          const modelInfoRes = makeMockResponse(200);
          const req = makeMockRequest(responseCallback, modelInfoRes);
          const origEnd = req.end.getMockImplementation?.() ?? (() => {});
          req.end = jest.fn(() => {
            origEnd();
            process.nextTick(() => {
              modelInfoRes.emit(
                'data',
                Buffer.from(
                  JSON.stringify({ siblings: [{ rfilename: 'model.safetensors' }], gated: false }),
                ),
              );
              modelInfoRes.emit('end');
            });
          });
          return req;
        }
        // Subsequent calls come from downloadFile inside the executor.
        // Return a 302 redirect to a blocked URL so downloadFile must call res.resume()
        // before it rejects — this is exactly the socket-leak scenario we're testing.
        const redirectRes = makeMockResponse(302, { location: 'http://169.254.169.254/metadata' });
        redirectRes.resume = downloadRedirectResumeSpy;
        return makeMockRequest(responseCallback, redirectRes);
      };
      httpsRequestSpy = jest.spyOn(https, 'request').mockImplementation(mockImpl as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'test/model', destinationType: 's3', bucketName: 'my-bucket' },
      });

      // Route queues the job and returns immediately with fileCount = 1
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).fileCount).toBe(1);
      expect(capturedFiles).toHaveLength(1);

      // Invoke the captured executor directly to exercise downloadFile's redirect branch.
      // It will reject (blocked redirect) — that's expected; we only care about resume().
      await capturedExecutor!(capturedFiles[0], new AbortController().signal, () => {}).catch(
        () => { /* downloadFile rejects after draining the blocked redirect — expected */ },
      );

      // resume() must have been called exactly once on the redirect response inside downloadFile
      expect(downloadRedirectResumeSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // queueJob destination tracking (Fix #42 — issue 1)
  // ---------------------------------------------------------------------------

  describe('queueJob destination tracking', () => {
    let httpsRequestSpy2: jest.SpyInstance | undefined;
    let queueJobSpy2: jest.SpyInstance | undefined;

    afterEach(() => {
      httpsRequestSpy2?.mockRestore();
      queueJobSpy2?.mockRestore();
      httpsRequestSpy2 = undefined;
      queueJobSpy2 = undefined;
    });

    /** Builds a mock https request that responds with a model-info JSON containing one file. */
    function makeModelInfoReq(responseCallback: (res: any) => void) {
      const modelInfoRes = new EventEmitter() as any;
      modelInfoRes.statusCode = 200;
      modelInfoRes.headers = {};
      modelInfoRes.resume = jest.fn();
      const req = new EventEmitter() as any;
      req.end = jest.fn(() => {
        responseCallback(modelInfoRes);
        process.nextTick(() => {
          modelInfoRes.emit(
            'data',
            Buffer.from(JSON.stringify({ siblings: [{ rfilename: 'model.bin' }], gated: false })),
          );
          modelInfoRes.emit('end');
        });
      });
      return req;
    }

    it('passes s3 destination with correct locationId and empty basePath to queueJob', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { transferQueue: mockedQueue } = require('../../src/utils/transferQueue');
      let capturedDestination: any;
      queueJobSpy2 = jest
        .spyOn(mockedQueue, 'queueJob')
        .mockImplementationOnce((_type: any, _files: any, _executor: any, destination: any): string => {
          capturedDestination = destination;
          return 'hf-s3-dest-job-id';
        });

      httpsRequestSpy2 = jest
        .spyOn(https, 'request')
        .mockImplementation((_opts: any, cb: any) => makeModelInfoReq(cb) as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'owner/model', destinationType: 's3', bucketName: 'my-bucket' },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedDestination).toEqual({ type: 's3', locationId: 'my-bucket', basePath: '' });
    });

    it('passes local destination with localPath as basePath to queueJob', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { transferQueue: mockedQueue } = require('../../src/utils/transferQueue');
      let capturedDestination: any;
      queueJobSpy2 = jest
        .spyOn(mockedQueue, 'queueJob')
        .mockImplementationOnce((_type: any, _files: any, _executor: any, destination: any): string => {
          capturedDestination = destination;
          return 'hf-local-dest-job-id';
        });

      httpsRequestSpy2 = jest
        .spyOn(https, 'request')
        .mockImplementation((_opts: any, cb: any) => makeModelInfoReq(cb) as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: {
          modelId: 'owner/model',
          destinationType: 'local',
          localLocationId: 'local-0',
          localPath: 'data/models',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedDestination).toEqual({ type: 'local', locationId: 'local-0', basePath: 'data/models' });
    });

    it('passes local destination with empty basePath when localPath is not set', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { transferQueue: mockedQueue } = require('../../src/utils/transferQueue');
      let capturedDestination: any;
      queueJobSpy2 = jest
        .spyOn(mockedQueue, 'queueJob')
        .mockImplementationOnce((_type: any, _files: any, _executor: any, destination: any): string => {
          capturedDestination = destination;
          return 'hf-local-no-path-job-id';
        });

      httpsRequestSpy2 = jest
        .spyOn(https, 'request')
        .mockImplementation((_opts: any, cb: any) => makeModelInfoReq(cb) as any);

      const response = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'owner/model', destinationType: 'local', localLocationId: 'local-0' },
      });

      expect(response.statusCode).toBe(200);
      expect(capturedDestination).toEqual({ type: 'local', locationId: 'local-0', basePath: '' });
    });
  });

  // ---------------------------------------------------------------------------
  // Partial file unlink on pipeline error (Fix #42 — issue 2)
  // ---------------------------------------------------------------------------

  describe('local destination partial file unlink on pipeline error', () => {
    let httpsRequestSpy3: jest.SpyInstance | undefined;
    let queueJobSpy3: jest.SpyInstance | undefined;
    let validatePathSpy: jest.SpyInstance | undefined;
    let mkdirSpy: jest.SpyInstance | undefined;
    let unlinkSpy: jest.SpyInstance | undefined;

    afterEach(() => {
      httpsRequestSpy3?.mockRestore();
      queueJobSpy3?.mockRestore();
      validatePathSpy?.mockRestore();
      mkdirSpy?.mockRestore();
      unlinkSpy?.mockRestore();
      httpsRequestSpy3 = undefined;
      queueJobSpy3 = undefined;
      validatePathSpy = undefined;
      mkdirSpy = undefined;
      unlinkSpy = undefined;
    });

    it('unlinks the partial local file when the download stream errors during pipeline', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { transferQueue: mockedQueue } = require('../../src/utils/transferQueue');
      let capturedExecutor: ((...args: any[]) => Promise<void>) | null = null;
      let capturedFiles: any[] = [];
      queueJobSpy3 = jest
        .spyOn(mockedQueue, 'queueJob')
        .mockImplementationOnce((_type: any, files: any, executor: any): string => {
          capturedExecutor = executor;
          capturedFiles = files;
          return 'hf-unlink-test-job';
        });

      // requestCallIndex tracks which call we are on across both phases
      let requestCallIndex = 0;
      httpsRequestSpy3 = jest.spyOn(https, 'request').mockImplementation((_opts: any, cb: any) => {
        const callIdx = requestCallIndex++;

        if (callIdx === 0) {
          // Phase 1 (app.inject): model info fetch — return one file
          const modelInfoRes = new EventEmitter() as any;
          modelInfoRes.statusCode = 200;
          modelInfoRes.headers = {};
          modelInfoRes.resume = jest.fn();
          const req = new EventEmitter() as any;
          req.end = jest.fn(() => {
            cb(modelInfoRes);
            process.nextTick(() => {
              modelInfoRes.emit(
                'data',
                Buffer.from(JSON.stringify({ siblings: [{ rfilename: 'model.bin' }], gated: false })),
              );
              modelInfoRes.emit('end');
            });
          });
          return req;
        }

        // Phase 2 (executor invocation): download fetch — return a readable that errors
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Readable } = require('stream');
        const errorStream = Object.assign(new Readable({ read() {} }), {
          statusCode: 200,
          headers: { 'content-length': '1000' },
          resume: jest.fn(),
        });
        const req = new EventEmitter() as any;
        req.end = jest.fn(() => {
          cb(errorStream);
          process.nextTick(() => {
            errorStream.destroy(new Error('Simulated network error'));
          });
        });
        return req;
      });

      // Queue the job and capture the executor
      const injectResponse = await app.inject({
        method: 'POST',
        url: '/api/objects/huggingface-import',
        payload: { modelId: 'owner/model', destinationType: 'local', localLocationId: 'local-0' },
      });
      expect(injectResponse.statusCode).toBe(200);
      expect(capturedExecutor).not.toBeNull();
      expect(capturedFiles).toHaveLength(1);

      // Set up fs mocks for the executor invocation
      const mockDestPath = `/tmp/test-storage/hf-partial-${Date.now()}.bin`;
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      validatePathSpy = jest.spyOn(require('../../src/utils/localStorage'), 'validatePath')
        .mockResolvedValue(mockDestPath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mkdirSpy = jest.spyOn(require('fs').promises, 'mkdir').mockResolvedValue(undefined as any);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      unlinkSpy = jest.spyOn(require('fs').promises, 'unlink').mockResolvedValue(undefined as any);

      // Invoke the executor — expect it to reject due to stream error
      await expect(
        capturedExecutor!(capturedFiles[0], new AbortController().signal, jest.fn()),
      ).rejects.toThrow('Simulated network error');

      // The catch block must have called unlink on the partial destination file
      expect(unlinkSpy).toHaveBeenCalledWith(mockDestPath);
    });
  });
});
