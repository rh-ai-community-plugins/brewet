import { renderHook, waitFor, act } from '@testing-library/react';
import { useDataConnections } from '../useDataConnections';

const mockSecrets = [
  {
    metadata: {
      name: 'my-s3-connection',
      namespace: 'test-ns',
      annotations: { 'opendatahub.io/connection-type': 's3' },
    },
    data: { AWS_S3_ENDPOINT: btoa('https://s3.example.com') },
  },
  {
    metadata: {
      name: 'my-other-secret',
      namespace: 'test-ns',
      annotations: { 'opendatahub.io/connection-type': 'postgres' },
    },
  },
  {
    metadata: {
      name: 'another-s3',
      namespace: 'test-ns',
      annotations: { 'opendatahub.io/connection-type-ref': 's3' },
    },
  },
];

describe('useDataConnections', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should not fetch when namespace is null', async () => {
    global.fetch = jest.fn();
    const { result } = renderHook(() => useDataConnections(null));

    expect(result.current.dataConnections).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch and filter S3 data connections', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: mockSecrets }),
    });

    const { result } = renderHook(() => useDataConnections('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.dataConnections).toHaveLength(2);
    expect(result.current.dataConnections[0].metadata.name).toBe('my-s3-connection');
    expect(result.current.dataConnections[1].metadata.name).toBe('another-s3');
    expect(result.current.error).toBeNull();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/namespaces/test-ns/secrets?labelSelector='),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should return error on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });

    const { result } = renderHook(() => useDataConnections('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.dataConnections).toEqual([]);
    expect(result.current.error).toBe('Failed to fetch data connections: 403');
  });

  it('should support refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: [] }),
    });

    const { result } = renderHook(() => useDataConnections('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
