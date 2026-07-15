import { storageService } from '../storageService';
import { apiClient } from '../apiClient';
import type { BucketsList, LocalStorageLocation } from '~/app/types/storage';

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
    { name: 'bucket-1', creationDate: '2024-01-01T00:00:00Z' },
    { name: 'bucket-2', creationDate: '2024-02-01T00:00:00Z' },
  ],
  owner: 'test-owner',
};

const mockLocalLocations: LocalStorageLocation[] = [
  { id: 'local-0', name: 'pvc-data', path: '/opt/app-root/src/pvc-data', available: true },
  { id: 'local-1', name: 'pvc-models', path: '/opt/app-root/src/pvc-models', available: false, error: 'Mount not found' },
];

function setupDefaultMocks() {
  mockApiClient.get.mockImplementation((_ns, path) => {
    if (path === '/api/buckets') return Promise.resolve(mockBuckets);
    if (path === '/api/local/locations') return Promise.resolve(mockLocalLocations);
    return Promise.reject(new Error('unexpected'));
  });
}

async function clearCache() {
  mockApiClient.get.mockImplementation((_ns, path) => {
    if (path === '/api/buckets') return Promise.resolve({ buckets: [] });
    if (path === '/api/local/locations') return Promise.resolve([]);
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
      expect(locations[0]).toEqual({
        id: 'bucket-1',
        name: 'bucket-1',
        type: 's3',
        status: 'available',
        creationDate: '2024-01-01T00:00:00Z',
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
        if (path === '/api/buckets') return Promise.reject(new Error('S3 error'));
        if (path === '/api/local/locations') return Promise.resolve(mockLocalLocations);
        return Promise.reject(new Error('unexpected'));
      });

      const locations = await storageService.refreshLocations('test-ns');
      expect(locations).toHaveLength(2);
      expect(locations[0].type).toBe('pvc');
    });

    it('should gracefully handle local storage failure', async () => {
      mockApiClient.get.mockImplementation((_ns, path) => {
        if (path === '/api/buckets') return Promise.resolve(mockBuckets);
        if (path === '/api/local/locations') return Promise.reject(new Error('FS error'));
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

      expect(mockApiClient.post).toHaveBeenCalledWith('ns', '/api/buckets', { bucketName: 'new-bucket' }, undefined);
    });
  });

  describe('deleteBucket', () => {
    it('should DELETE the bucket and invalidate cache', async () => {
      mockApiClient.delete.mockResolvedValue(undefined);

      await storageService.deleteBucket('ns', 'old-bucket');

      expect(mockApiClient.delete).toHaveBeenCalledWith('ns', '/api/buckets/old-bucket', undefined);
    });
  });

  describe('listFiles', () => {
    it('should list S3 objects with encoded path', async () => {
      const mockResponse = { files: [], isTruncated: false };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const location = { id: 'my-bucket', name: 'my-bucket', type: 's3' as const, status: 'available' as const };
      await storageService.listFiles('ns', location, 'some/path');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        'ns',
        expect.stringContaining('/api/objects/my-bucket/'),
        undefined,
      );
    });

    it('should list local files with encoded path', async () => {
      const mockResponse = { files: [], totalCount: 0 };
      mockApiClient.get.mockResolvedValue(mockResponse);

      const location = { id: 'local-0', name: 'pvc-data', type: 'pvc' as const, status: 'available' as const };
      await storageService.listFiles('ns', location, '/data');

      expect(mockApiClient.get).toHaveBeenCalledWith(
        'ns',
        expect.stringContaining('/api/local/files/local-0/'),
        undefined,
      );
    });

    it('should pass S3 pagination params', async () => {
      mockApiClient.get.mockResolvedValue({ files: [] });

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
  });

  describe('downloadFile', () => {
    it('should return S3 download URL', async () => {
      mockApiClient.getDownloadUrl.mockReturnValue('/brewet/api/ns/api/objects/download/bucket/encoded');

      const location = { id: 'bucket', name: 'bucket', type: 's3' as const, status: 'available' as const };
      const url = await storageService.downloadFile('ns', location, 'file.txt');

      expect(url).toContain('/api/objects/download/bucket/');
    });

    it('should return PVC download URL', async () => {
      mockApiClient.getDownloadUrl.mockReturnValue('/brewet/api/ns/api/local/download/local-0/encoded');

      const location = { id: 'local-0', name: 'pvc', type: 'pvc' as const, status: 'available' as const };
      const url = await storageService.downloadFile('ns', location, '/data/file.txt');

      expect(url).toContain('/api/local/download/local-0/');
    });
  });
});
