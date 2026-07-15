import { renderHook, waitFor, act } from '@testing-library/react';
import { usePVCs } from '../usePVCs';

const mockPvcs = [
  {
    metadata: { name: 'data-pvc', namespace: 'test-ns' },
    spec: { resources: { requests: { storage: '10Gi' } } },
    status: { phase: 'Bound', capacity: { storage: '10Gi' } },
  },
  {
    metadata: { name: 'models-pvc', namespace: 'test-ns' },
    spec: { resources: { requests: { storage: '50Gi' } } },
    status: { phase: 'Bound', capacity: { storage: '50Gi' } },
  },
];

describe('usePVCs', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should not fetch when namespace is null', () => {
    global.fetch = jest.fn();
    const { result } = renderHook(() => usePVCs(null));

    expect(result.current.pvcs).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fetch PVCs for the given namespace', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: mockPvcs }),
    });

    const { result } = renderHook(() => usePVCs('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pvcs).toHaveLength(2);
    expect(result.current.pvcs[0].metadata.name).toBe('data-pvc');
    expect(result.current.error).toBeNull();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/k8s/api/v1/namespaces/test-ns/persistentvolumeclaims',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should return error on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderHook(() => usePVCs('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.pvcs).toEqual([]);
    expect(result.current.error).toBe('Failed to fetch PVCs: 500');
  });

  it('should support refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: mockPvcs }),
    });

    const { result } = renderHook(() => usePVCs('test-ns'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
