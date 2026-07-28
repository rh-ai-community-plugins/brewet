import Fastify, { FastifyInstance } from 'fastify';
import localRoutes from '../../src/routes/api/local/index';

jest.mock('../../src/utils/localStorage', () => ({
  ...jest.requireActual('../../src/utils/localStorage'),
  validatePath: jest.fn(),
  getStorageLocations: jest.fn(),
  listDirectory: jest.fn(),
  createDirectory: jest.fn(),
  deleteFileOrDirectory: jest.fn(),
  getFileMetadata: jest.fn(),
  streamFile: jest.fn(),
  checkFileSize: jest.fn(),
  SecurityError: jest.requireActual('../../src/utils/localStorage').SecurityError,
  NotFoundError: jest.requireActual('../../src/utils/localStorage').NotFoundError,
  PermissionError: jest.requireActual('../../src/utils/localStorage').PermissionError,
  StorageError: jest.requireActual('../../src/utils/localStorage').StorageError,
}));

jest.mock('../../src/utils/config', () => ({
  getLocalStoragePaths: () => ['/tmp/test-storage'],
  getMaxFileSizeBytes: () => 100 * 1024 * 1024,
}));

import {
  validatePath,
  getStorageLocations,
  listDirectory,
  SecurityError,
  NotFoundError,
  PermissionError,
  StorageError,
} from '../../src/utils/localStorage';

const mockValidatePath = validatePath as jest.Mock;
const mockGetStorageLocations = getStorageLocations as jest.Mock;
const mockListDirectory = listDirectory as jest.Mock;

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  await app.register(require('@fastify/multipart'));
  app.register(localRoutes, { prefix: '/api/local' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('handleError — 500 catch-all', () => {
  it('returns generic message for unexpected filesystem errors and does not expose paths', async () => {
    const fsError = Object.assign(new Error('ENOTDIR: not a directory, scandir \'/opt/app-root/src/data/uploads/secret\''), { code: 'ENOTDIR' });
    mockValidatePath.mockResolvedValue('/tmp/test-storage');
    mockListDirectory.mockRejectedValue(fsError);

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/files/local-0/',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('An unexpected error occurred while processing the request.');
    expect(body.message).not.toContain('/opt/app-root');
    expect(body.message).not.toContain('secret');
  });

  it('returns generic message for EBUSY errors without exposing paths', async () => {
    const fsError = Object.assign(new Error('EBUSY: resource busy or locked, unlink \'/opt/app-root/src/data/locked-file\''), { code: 'EBUSY' });
    mockValidatePath.mockResolvedValue('/tmp/test-storage');
    mockListDirectory.mockRejectedValue(fsError);

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/files/local-0/',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('An unexpected error occurred while processing the request.');
    expect(body.message).not.toContain('/opt/app-root');
  });
});

describe('handleError — typed errors still return controlled messages', () => {
  it('returns 403 for SecurityError', async () => {
    mockValidatePath.mockRejectedValue(new SecurityError('Path traversal attempt detected'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/files/local-0/',
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Forbidden');
    expect(body.message).toBe('Path traversal attempt detected');
  });

  it('returns 404 for NotFoundError', async () => {
    mockValidatePath.mockRejectedValue(new NotFoundError('Location not found'));

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/files/local-0/',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not Found');
  });
});

describe('handleError — ENOENT and EACCES return generic messages', () => {
  it('returns 404 for ENOENT without exposing filesystem path', async () => {
    const fsError = Object.assign(new Error('ENOENT: no such file or directory, stat \'/opt/app-root/src/data/missing\''), { code: 'ENOENT' });
    mockValidatePath.mockResolvedValue('/tmp/test-storage');
    mockListDirectory.mockRejectedValue(fsError);

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/files/local-0/',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('The requested file or directory was not found.');
    expect(body.message).not.toContain('/opt/app-root');
  });

  it('returns 403 for EACCES without exposing filesystem path', async () => {
    const fsError = Object.assign(new Error('EACCES: permission denied, open \'/opt/app-root/src/data/protected\''), { code: 'EACCES' });
    mockValidatePath.mockResolvedValue('/tmp/test-storage');
    mockListDirectory.mockRejectedValue(fsError);

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/files/local-0/',
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.message).toBe('Access to the requested resource is not permitted.');
    expect(body.message).not.toContain('/opt/app-root');
  });
});

describe('GET /api/local/locations', () => {
  it('returns storage locations', async () => {
    mockGetStorageLocations.mockResolvedValue([
      { id: 'local-0', name: 'Storage 1', path: '/tmp/test-storage', type: 'local', available: true },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/local/locations',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.locations).toHaveLength(1);
    expect(body.locations[0].id).toBe('local-0');
  });
});
