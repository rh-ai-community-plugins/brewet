import { storageService, transformS3Response, transformLocalResponse } from '../storageService';
import { apiClient } from '../apiClient';
import type {
  BucketsList,
  LocalStorageLocation,
  RawS3ListResponse,
  RawLocalListResponse,
} from '~/app/types/storage';

jest.mock('../apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    uploadFile: jest.fn(),
    getDownloadUrl: jest.fn(),
  },
}));

const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

const mockBuckets: BucketsList = {
  buckets: [
    { Name: 'bucket-1', CreationDate: '2024-01-01T00:00:00Z' },
    { Name: 'bucket-2', CreationDate: '2024-02-01T00:00:00Z' },
  ],
};

const mockLocalLocations: LocalStorageLocation[] = [
  { id: 'local-0', name: 'pvc-data', path: '/opt/app-root/src/pvc-data', available: true },
  { id: 'local-1', name: 'pvc-models', path: '/opt/app-root/src/pvc-models', available: false, error: 'Mount not found' },
];

function setupDefaultMocks() {
  mockApiClient.get.mockImplementation((_ns, path) => {
    if (path === '/buckets') return Promise.resolve(mockBuckets);
    if (path === '/local/locations') return Promise.resolve({ locations: mockLocalLocations });
    return Promise.reject(new Error('unexpected'));
  });
}

async function clearCache() {
  mockApiClient.get.mockImplementation((_ns, path) => {
    if (path === '/buckets') return Promise.resolve({ buckets: [] });
    if (path === '/local/locations') return Promise.resolve({ locations: [] });
    return Promise.resolve({});
  });
  await storageService.refreshLocations('_reset_');
}

describe('storageService', () => {
  beforeEach(async () => {
    jest.resetAllMocks();
    await clearCache();
    jest.resetAllMocks();
  });

  describe('getLocations', () => {
    it('should merge S3 buckets and local locations', async () => {
      setupDefaultMocks();

      const locations = await storageService.refreshLocations('test-ns');

      expect(locations).toHaveLength(4);
      expect(locations[0]).toMatchObject({
        id: 'bucket-1',
        name: 'bucket-1',
        type: 's3',
        status: 'available',
      });
      expect(locations[2]).toEqual({
        id: 'local-0',
        name: 'pvc-data',
        type: 'pvc',
        status: 'available',
        error: undefined,
      });
      expect(locations[3].status).toBe('unavailable');
    });

    it('should cache results after first call', async () => {
      setupDefaultMocks();

      await storageService.refreshLocations('test-ns');
      jest.resetAllMocks();

      const cached = await storageService.getLocations('test-ns');
      expect(cached).toHaveLength(4);
      expect(mockApiClient.get).not.toHaveBeenCalled();
    });

    it('should gracefully handle S3 failure', async () => {
      mockApiClient.get.mockImplementation((_ns, path) => {
        if (path === '/buckets') return Promise.reject(new Error('S3 error'));
        if (path === '/local/locations') return Promise.resolve({ locations: mockLocalLocations });
        return Promise.reject(new Error('unexpected'));
      });

      const locations = await storageService.refreshLocations('test-ns');
      expect(locations).toHaveLength(2);
      expect(locations[0].type).toBe('pvc');
    });

    it('should gracefully handle local storage failure', async () => {
      mockApiClient.get.mockImplementation((_ns, path) => {
        if (path === '/buckets') return Promise.resolve(mockBuckets);
        if (path === '/local/locations') return Promise.reject(new Error('FS error'));
        return Promise.reject(new Error('unexpected'));
      });

      const locations = await storageService.refreshLocations('test-ns');
      expect(locations).toHaveLength(2);
      expect(locations[0].type).toBe('s3');
    });
  });

  describe('refreshLocations', () => {
    it('should clear cache and re-fetch', async () => {
      setupDefaultMocks();

      await storageService.refreshLocations('test-ns');
      expect(mockApiClient.get).toHaveBeenCalledTimes(2);

      await storageService.refreshLocations('test-ns');
      expect(mockApiClient.get).toHaveBeenCalledTimes(4);
    });
  });

  describe('createBucket', () => {
    it('should POST to buckets endpoint and invalidate cache', async () => {
      mockApiClient.post.mockResolvedValue(undefined);

      await storageService.createBucket('ns', 'new-bucket');

      expect(mockApiClient.post).toHaveBeenCalledWith('ns', '/buckets', { bucketName: 'new-bucket' }, undefined);
    });
  });

  describe('deleteBucket', () => {
    it('should DELETE the bucket and invalidate cache', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await storageService.deleteBucket('ns', 'old-bucket');

      expect(mockApiClient.delete).toHaveBeenCalledWith('ns', '/buckets/old-bucket', undefined);
    });
  });

  describe('listFiles', () => {
    it('should list S3 objects with encoded path and transform response', async () => {
      const rawS3Response: RawS3ListResponse = {
        objects: [
          { Key: 'some/path/file.txt', Size: 1024, LastModified: '2024-01-01T00:00:00Z', ETag: '"abc123"' },
        ],
        prefixes: [
          { Prefix: 'some/path/subdir/' },
        ],
        nextContinuationToken: null,
        isTruncated: false,
      };
      mockApiClient.get.mockResolvedValue(rawS3Response);

      const location = { id: 'my-bucket', name: 'my-bucket', type: 's3' as const, status: 'available' as const };
      const result = await storageService.listFiles('ns', location, 'some/path');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        'ns',
        expect.stringContaining('/objects/my-bucket/'),
        undefined,
      );
      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({ name: 'subdir', isDirectory: true });
      expect(result.files[1]).toEqual({
        name: 'file.txt',
        isDirectory: false,
        size: 1024,
        lastModified: '2024-01-01T00:00:00Z',
        etag: '"abc123"',
      });
    });

    it('should list local files with encoded path and transform response', async () => {
      const rawLocalResponse: RawLocalListResponse = {
        files: [
          { name: 'docs', path: 'docs', type: 'directory', size: 4096, modified: '2024-03-01T00:00:00Z' },
          { name: 'readme.txt', path: 'readme.txt', type: 'file', size: 512, modified: '2024-02-15T00:00:00Z' },
        ],
        currentPath: '',
        parentPath: null,
        totalCount: 2,
      };
      mockApiClient.get.mockResolvedValue(rawLocalResponse);

      const location = { id: 'local-0', name: 'pvc-data', type: 'pvc' as const, status: 'available' as const };
      const result = await storageService.listFiles('ns', location, '/data');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        'ns',
        expect.stringContaining('/local/files/local-0/'),
        undefined,
      );
      expect(result.files).toHaveLength(2);
      expect(result.files[0]).toEqual({
        name: 'docs',
        isDirectory: true,
        size: 4096,
        lastModified: '2024-03-01T00:00:00Z',
      });
      expect(result.files[1]).toEqual({
        name: 'readme.txt',
        isDirectory: false,
        size: 512,
        lastModified: '2024-02-15T00:00:00Z',
      });
      expect(result.totalCount).toBe(2);
    });

    it('should pass S3 pagination params', async () => {
      mockApiClient.get.mockResolvedValue({ objects: [], prefixes: [], isTruncated: false });

      const location = { id: 'bucket', name: 'bucket', type: 's3' as const, status: 'available' as const };
      await storageService.listFiles('ns', location, '', {
        continuationToken: 'token123',
        maxKeys: 50,
      });

      expect(mockApiClient.get).toHaveBeenCalledWith(
        'ns',
        expect.stringContaining('continuationToken=token123'),
        undefined,
      );
      expect(mockApiClient.get).toHaveBeenCalledWith(
        'ns',
        expect.stringContaining('maxKeys=50'),
        undefined,
      );
    });

    it('should not drop maxKeys=0', async () => {
      mockApiClient.get.mockResolvedValue({ objects: [], prefixes: [], isTruncated: false });

      const location = { id: 'bucket', name: 'bucket', type: 's3' as const, status: 'available' as const };
      await storageService.listFiles('ns', location, '', { maxKeys: 0 });

      const url = mockApiClient.get.mock.calls[0][1] as string;
      expect(url).toContain('maxKeys=0');
    });

    it('should not drop limit=0 or offset=0 for PVC', async () => {
      mockApiClient.get.mockResolvedValue({ files: [], totalCount: 0 });

      const location = { id: 'local-0', name: 'pvc', type: 'pvc' as const, status: 'available' as const };
      await storageService.listFiles('ns', location, '/', { limit: 0, offset: 0 });

      const url = mockApiClient.get.mock.calls[0][1] as string;
      expect(url).toContain('limit=0');
      expect(url).toContain('offset=0');
    });

    it('should send search as q param with mode', async () => {
      mockApiClient.get.mockResolvedValue({ objects: [], prefixes: [], isTruncated: false });

      const location = { id: 'bucket', name: 'bucket', type: 's3' as const, status: 'available' as const };
      await storageService.listFiles('ns', location, '', {
        search: 'model',
        searchMode: 'contains',
      });

      const url = mockApiClient.get.mock.calls[0][1] as string;
      expect(url).toContain('q=model');
      expect(url).toContain('mode=contains');
      expect(url).not.toContain('prefix=');
    });
  });

  describe('downloadFile', () => {
    it('should return S3 download URL', async () => {
      mockApiClient.getDownloadUrl.mockReturnValue('/brewet/api/ns/objects/download/bucket/encoded');

      const location = { id: 'bucket', name: 'bucket', type: 's3' as const, status: 'available' as const };
      const url = await storageService.downloadFile('ns', location, 'file.txt');

      expect(url).toContain('/objects/download/bucket/');
    });

    it('should return PVC download URL', async () => {
      mockApiClient.getDownloadUrl.mockReturnValue('/brewet/api/ns/local/download/local-0/encoded');

      const location = { id: 'local-0', name: 'pvc', type: 'pvc' as const, status: 'available' as const };
      const url = await storageService.downloadFile('ns', location, '/data/file.txt');

      expect(url).toContain('/local/download/local-0/');
    });
  });

  describe('cancelTransfer', () => {
    it('should DELETE transfer by jobId', async () => {
      mockApiClient.delete.mockResolvedValue({ cancelled: true, jobId: 'j1' });

      const result = await storageService.cancelTransfer('ns', 'j1');
      expect(mockApiClient.delete).toHaveBeenCalledWith('ns', '/transfer/j1', undefined);
      expect(result).toEqual({ cancelled: true, jobId: 'j1' });
    });
  });

  describe('cleanupTransfer', () => {
    it('should POST to cleanup endpoint', async () => {
      mockApiClient.post.mockResolvedValue({ cleaned: 3, errors: 0, jobId: 'j2' });

      const result = await storageService.cleanupTransfer('ns', 'j2');
      expect(mockApiClient.post).toHaveBeenCalledWith('ns', '/transfer/j2/cleanup', undefined, undefined);
      expect(result).toEqual({ cleaned: 3, errors: 0, jobId: 'j2' });
    });
  });

  describe('getTransferProgress', () => {
    it('should GET transfer progress by jobId', async () => {
      const progress = {
        jobId: 'j3',
        status: 'active',
        type: 'cross-storage',
        totalFiles: 5,
        completedFiles: 2,
        failedFiles: 0,
        cancelledFiles: 0,
        totalBytes: 5000,
        loadedBytes: 2000,
        files: [],
      };
      mockApiClient.get.mockResolvedValue(progress);

      const result = await storageService.getTransferProgress('ns', 'j3');
      expect(mockApiClient.get).toHaveBeenCalledWith('ns', '/transfer/j3', undefined);
      expect(result).toEqual(progress);
    });
  });

  describe('getTransferSseUrl', () => {
    it('should strip /api prefix and build URL via apiClient', () => {
      mockApiClient.getDownloadUrl.mockReturnValue('/brewet/api/ns/transfer/progress/j4');

      const url = storageService.getTransferSseUrl('ns', '/api/transfer/progress/j4');
      expect(mockApiClient.getDownloadUrl).toHaveBeenCalledWith('ns', '/transfer/progress/j4');
      expect(url).toBe('/brewet/api/ns/transfer/progress/j4');
    });
  });
});

describe('transformS3Response', () => {
  it('should map objects to FileInfo with isDirectory: false', () => {
    const raw: RawS3ListResponse = {
      objects: [
        { Key: 'prefix/file1.txt', Size: 100, LastModified: '2024-01-01T00:00:00Z', ETag: '"etag1"' },
        { Key: 'prefix/file2.json', Size: 200 },
      ],
      prefixes: [],
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({
      name: 'file1.txt',
      isDirectory: false,
      size: 100,
      lastModified: '2024-01-01T00:00:00Z',
      etag: '"etag1"',
    });
    expect(result.files[1]).toEqual({
      name: 'file2.json',
      isDirectory: false,
      size: 200,
      lastModified: undefined,
      etag: undefined,
    });
  });

  it('should map prefixes to FileInfo with isDirectory: true', () => {
    const raw: RawS3ListResponse = {
      objects: [],
      prefixes: [
        { Prefix: 'data/models/' },
        { Prefix: 'data/configs/' },
      ],
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({ name: 'models', isDirectory: true });
    expect(result.files[1]).toEqual({ name: 'configs', isDirectory: true });
  });

  it('should skip folder marker objects (keys ending with /)', () => {
    const raw: RawS3ListResponse = {
      objects: [
        { Key: 'data/', Size: 0 },
        { Key: 'data/real-file.txt', Size: 50 },
      ],
      prefixes: [],
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].name).toBe('real-file.txt');
  });

  it('should map nextContinuationToken to continuationToken', () => {
    const raw: RawS3ListResponse = {
      objects: [],
      prefixes: [],
      nextContinuationToken: 'abc123',
      isTruncated: true,
    };

    const result = transformS3Response(raw);

    expect(result.continuationToken).toBe('abc123');
    expect(result.isTruncated).toBe(true);
  });

  it('should set continuationToken to undefined when nextContinuationToken is null', () => {
    const raw: RawS3ListResponse = {
      objects: [],
      prefixes: [],
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.continuationToken).toBeUndefined();
    expect(result.isTruncated).toBe(false);
  });

  it('should handle undefined objects and prefixes', () => {
    const raw: RawS3ListResponse = {
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.files).toHaveLength(0);
  });

  it('should place directories before files', () => {
    const raw: RawS3ListResponse = {
      objects: [
        { Key: 'a-file.txt', Size: 10 },
      ],
      prefixes: [
        { Prefix: 'z-folder/' },
      ],
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({ name: 'z-folder', isDirectory: true });
    expect(result.files[1].name).toBe('a-file.txt');
    expect(result.files[1].isDirectory).toBe(false);
  });

  it('should extract leaf name from nested keys', () => {
    const raw: RawS3ListResponse = {
      objects: [
        { Key: 'a/b/c/deep-file.txt', Size: 5 },
      ],
      prefixes: [
        { Prefix: 'a/b/c/deep-folder/' },
      ],
      nextContinuationToken: null,
      isTruncated: false,
    };

    const result = transformS3Response(raw);

    expect(result.files[0].name).toBe('deep-folder');
    expect(result.files[1].name).toBe('deep-file.txt');
  });
});

describe('transformLocalResponse', () => {
  it('should map type=directory to isDirectory: true', () => {
    const raw: RawLocalListResponse = {
      files: [
        { name: 'models', path: 'models', type: 'directory', size: 4096, modified: '2024-06-01T12:00:00Z' },
      ],
      totalCount: 1,
    };

    const result = transformLocalResponse(raw);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      name: 'models',
      isDirectory: true,
      size: 4096,
      lastModified: '2024-06-01T12:00:00Z',
    });
  });

  it('should map type=file to isDirectory: false', () => {
    const raw: RawLocalListResponse = {
      files: [
        { name: 'data.csv', path: 'data.csv', type: 'file', size: 2048, modified: '2024-05-15T08:30:00Z' },
      ],
      totalCount: 1,
    };

    const result = transformLocalResponse(raw);

    expect(result.files[0]).toEqual({
      name: 'data.csv',
      isDirectory: false,
      size: 2048,
      lastModified: '2024-05-15T08:30:00Z',
    });
  });

  it('should map type=symlink to isDirectory: false', () => {
    const raw: RawLocalListResponse = {
      files: [
        { name: 'link.txt', path: 'link.txt', type: 'symlink', size: 100 },
      ],
      totalCount: 1,
    };

    const result = transformLocalResponse(raw);

    expect(result.files[0].isDirectory).toBe(false);
    expect(result.files[0].lastModified).toBeUndefined();
  });

  it('should preserve totalCount from the raw response', () => {
    const raw: RawLocalListResponse = {
      files: [
        { name: 'a.txt', path: 'a.txt', type: 'file', size: 10 },
      ],
      totalCount: 50,
    };

    const result = transformLocalResponse(raw);

    expect(result.totalCount).toBe(50);
    expect(result.files).toHaveLength(1);
  });

  it('should handle empty file list', () => {
    const raw: RawLocalListResponse = {
      files: [],
      totalCount: 0,
    };

    const result = transformLocalResponse(raw);

    expect(result.files).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it('should map modified to lastModified', () => {
    const raw: RawLocalListResponse = {
      files: [
        { name: 'test.txt', path: 'test.txt', type: 'file', modified: '2024-12-25T00:00:00Z' },
      ],
      totalCount: 1,
    };

    const result = transformLocalResponse(raw);

    expect(result.files[0].lastModified).toBe('2024-12-25T00:00:00Z');
  });
});
