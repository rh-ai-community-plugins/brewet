import { apiClient, ApiError } from '../apiClient';

describe('apiClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('get', () => {
    it('should call fetch with correct URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'test' }),
      });

      const result = await apiClient.get('my-ns', '/api/buckets');
      expect(result).toEqual({ data: 'test' });
      expect(global.fetch).toHaveBeenCalledWith('/brewet/api/my-ns/api/buckets', { signal: undefined });
    });

    it('should encode namespace in URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      await apiClient.get('ns with spaces', '/api/buckets');
      expect(global.fetch).toHaveBeenCalledWith(
        '/brewet/api/ns%20with%20spaces/api/buckets',
        expect.any(Object),
      );
    });

    it('should pass abort signal', async () => {
      const controller = new AbortController();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      await apiClient.get('ns', '/api/test', controller.signal);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        { signal: controller.signal },
      );
    });
  });

  describe('post', () => {
    it('should send JSON body', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ created: true }),
      });

      const result = await apiClient.post('ns', '/api/buckets', { bucketName: 'test' });
      expect(result).toEqual({ created: true });
      expect(global.fetch).toHaveBeenCalledWith(
        '/brewet/api/ns/api/buckets',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucketName: 'test' }),
        }),
      );
    });
  });

  describe('delete', () => {
    it('should send DELETE request', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      });

      await apiClient.delete('ns', '/api/buckets/my-bucket');
      expect(global.fetch).toHaveBeenCalledWith(
        '/brewet/api/ns/api/buckets/my-bucket',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('error handling', () => {
    it('should throw ApiError with 401 message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve(''),
      });

      await expect(apiClient.get('ns', '/api/test')).rejects.toThrow(ApiError);
      await expect(apiClient.get('ns', '/api/test')).rejects.toThrow('Authentication required');
    });

    it('should throw ApiError with 503 message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: () => Promise.resolve(''),
      });

      await expect(apiClient.get('ns', '/api/test')).rejects.toThrow('Storage container is not running');
    });

    it('should throw ApiError with response body for other errors', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: () => Promise.resolve('Something went wrong'),
      });

      await expect(apiClient.get('ns', '/api/test')).rejects.toThrow('Something went wrong');
    });
  });

  describe('getDownloadUrl', () => {
    it('should return the full URL', () => {
      const url = apiClient.getDownloadUrl('ns', '/api/objects/download/bucket/key');
      expect(url).toBe('/brewet/api/ns/api/objects/download/bucket/key');
    });
  });
});
