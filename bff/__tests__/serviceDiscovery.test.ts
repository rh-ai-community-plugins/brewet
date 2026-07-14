import {
  resolveStorageBackend,
  clearCache,
  SERVICE_NAME,
  SERVICE_PORT,
} from '../src/utils/serviceDiscovery';

jest.mock('../src/utils/k8sClient', () => ({
  k8sRequest: jest.fn(),
  getK8sBaseUrl: jest.fn(),
}));

import { k8sRequest } from '../src/utils/k8sClient';

const mockedK8sRequest = jest.mocked(k8sRequest);

describe('resolveStorageBackend', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    process.env = { ...originalEnv };
    delete process.env.STORAGE_BACKEND_URL;
    delete process.env.K8S_SA_TOKEN;
    process.env.K8S_SA_TOKEN = 'test-sa-token';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns STORAGE_BACKEND_URL when set, skipping K8s API', async () => {
    process.env.STORAGE_BACKEND_URL = 'http://localhost:8888';
    const url = await resolveStorageBackend('test-ns');
    expect(url).toBe('http://localhost:8888');
    expect(mockedK8sRequest).not.toHaveBeenCalled();
  });

  it('calls K8s API and constructs cluster-internal URL on cache miss', async () => {
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });
    const url = await resolveStorageBackend('my-project');
    expect(url).toBe(
      `http://${SERVICE_NAME}.my-project.svc.cluster.local:${SERVICE_PORT}`,
    );
    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'test-sa-token',
      `/api/v1/namespaces/my-project/services/${SERVICE_NAME}`,
    );
  });

  it('returns cached URL without a second API call', async () => {
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });
    await resolveStorageBackend('my-project');
    await resolveStorageBackend('my-project');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(1);
  });

  it('refreshes cache after TTL expires', async () => {
    jest.useFakeTimers();
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });

    await resolveStorageBackend('my-project');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(31_000);

    await resolveStorageBackend('my-project');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('caches per namespace independently', async () => {
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });
    await resolveStorageBackend('ns-a');
    await resolveStorageBackend('ns-b');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(2);

    await resolveStorageBackend('ns-a');
    await resolveStorageBackend('ns-b');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(2);
  });

  it('propagates K8s API 404 error', async () => {
    mockedK8sRequest.mockRejectedValue(
      new Error('K8s API returned 404: {"message":"not found"}'),
    );
    await expect(resolveStorageBackend('no-such-ns')).rejects.toThrow(
      'K8s API returned 404',
    );
  });

  it('does not cache failed lookups', async () => {
    mockedK8sRequest.mockRejectedValueOnce(
      new Error('K8s API returned 404: not found'),
    );
    await expect(resolveStorageBackend('my-project')).rejects.toThrow();

    mockedK8sRequest.mockResolvedValueOnce({
      metadata: { name: SERVICE_NAME },
    });
    const url = await resolveStorageBackend('my-project');
    expect(url).toContain('my-project');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(2);
  });

  it('clears cache for a specific namespace', async () => {
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });
    await resolveStorageBackend('ns-a');
    await resolveStorageBackend('ns-b');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(2);

    clearCache('ns-a');

    await resolveStorageBackend('ns-a');
    await resolveStorageBackend('ns-b');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(3);
  });

  it('clears entire cache', async () => {
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });
    await resolveStorageBackend('ns-a');
    await resolveStorageBackend('ns-b');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(2);

    clearCache();

    await resolveStorageBackend('ns-a');
    await resolveStorageBackend('ns-b');
    expect(mockedK8sRequest).toHaveBeenCalledTimes(4);
  });

  it('reads SA token from K8S_SA_TOKEN env var', async () => {
    process.env.K8S_SA_TOKEN = 'my-sa-token';
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });

    await resolveStorageBackend('my-project');
    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'my-sa-token',
      expect.any(String),
    );
  });

  it('throws when no SA token is available', async () => {
    delete process.env.K8S_SA_TOKEN;
    await expect(resolveStorageBackend('my-project')).rejects.toThrow(
      'ServiceAccount token not available',
    );
  });

  it('URL-encodes namespace in K8s API path', async () => {
    mockedK8sRequest.mockResolvedValue({ metadata: { name: SERVICE_NAME } });
    await resolveStorageBackend('ns/with/slashes');
    expect(mockedK8sRequest).toHaveBeenCalledWith(
      'test-sa-token',
      `/api/v1/namespaces/ns%2Fwith%2Fslashes/services/${SERVICE_NAME}`,
    );
  });
});
