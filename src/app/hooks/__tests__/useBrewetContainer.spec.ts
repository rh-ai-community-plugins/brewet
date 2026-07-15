import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { BrewetProvider } from '../../context/BrewetContext';
import { useBrewetContainer } from '../useBrewetContainer';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(BrewetProvider, null, children);
}

const mockDeployment = {
  metadata: { name: 'brewet-storage-backend', namespace: 'test-ns' },
  spec: { replicas: 1 },
  status: { readyReplicas: 1 },
};

describe('useBrewetContainer', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockDeployment),
    });
  });

  it('should provide lifecycle actions', () => {
    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    expect(result.current.startContainer).toBeDefined();
    expect(result.current.stopContainer).toBeDefined();
    expect(result.current.deleteContainer).toBeDefined();
    expect(result.current.createContainer).toBeDefined();
    expect(result.current.updateContainer).toBeDefined();
    expect(result.current.isActioning).toBe(false);
  });

  it('should start container by scaling to 1', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          ...mockDeployment,
          spec: { replicas: 0 },
          status: { readyReplicas: 0 },
        }),
      })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('stopped');
    });

    await act(async () => {
      result.current.startContainer();
    });

    const scaleCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string]) => call[0].includes('/scale'),
    );
    expect(scaleCalls).toHaveLength(1);

    const body = JSON.parse(scaleCalls[0][1].body);
    expect(body.spec.replicas).toBe(1);
  });

  it('should stop container by scaling to 0', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDeployment),
      })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('running');
    });

    await act(async () => {
      result.current.stopContainer();
    });

    const scaleCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string]) => call[0].includes('/scale'),
    );
    expect(scaleCalls).toHaveLength(1);

    const body = JSON.parse(scaleCalls[0][1].body);
    expect(body.spec.replicas).toBe(0);
  });

  it('should delete all three resources', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDeployment),
      })
      .mockResolvedValue({ ok: true, status: 200 });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('running');
    });

    await act(async () => {
      result.current.deleteContainer();
    });

    const deleteCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string, RequestInit]) => call[1]?.method === 'DELETE',
    );
    expect(deleteCalls).toHaveLength(3);
    expect(deleteCalls[0][0]).toContain('networkpolicies');
    expect(deleteCalls[1][0]).toContain('services');
    expect(deleteCalls[2][0]).toContain('deployments');
  });

  it('should create deployment, service, and network policy', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('none');
    });

    let results: Array<{ resource: string; success: boolean }> = [];
    await act(async () => {
      results = await result.current.createContainer({
        dataConnection: null,
        pvcMounts: [],
      });
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.success)).toBe(true);

    const postCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string, RequestInit]) => call[1]?.method === 'POST',
    );
    expect(postCalls).toHaveLength(3);
  });

  it('should rollback on partial create failure', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    let callCount = 0;
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      }
      if (init.method === 'POST') {
        callCount++;
        if (callCount === 2) {
          return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('error') });
        }
        return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 200 });
    });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('none');
    });

    let results: Array<{ resource: string; success: boolean }> = [];
    await act(async () => {
      results = await result.current.createContainer({
        dataConnection: null,
        pvcMounts: [],
      });
    });

    const failedResource = results.find((r) => !r.success);
    expect(failedResource).toBeDefined();

    const deleteCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string, RequestInit]) => call[1]?.method === 'DELETE',
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
  });

  it('should use PATCH for update', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDeployment),
      })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('running');
    });

    await act(async () => {
      await result.current.updateContainer({
        dataConnection: null,
        pvcMounts: [],
      });
    });

    const patchCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string, RequestInit]) => call[1]?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0][1].headers).toEqual({
      'Content-Type': 'application/strategic-merge-patch+json',
    });
  });

  it('should return Operation:Aborted entry and rollback on abort during create', async () => {
    localStorage.setItem('brewet.selected-project', 'test-ns');

    let abortCalled = false;
    const abortError = Object.assign(new Error('AbortError'), { name: 'AbortError' });

    let postCallCount = 0;
    global.fetch = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') {
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      }
      if (init.method === 'POST') {
        postCallCount++;
        if (postCallCount === 1) {
          return Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) });
        }
        // Second POST (Service) throws AbortError
        abortCalled = true;
        return Promise.reject(abortError);
      }
      return Promise.resolve({ ok: true, status: 200 });
    });

    const { result } = renderHook(() => useBrewetContainer(), { wrapper });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('none');
    });

    let results: Array<{ resource: string; success: boolean; error?: string }> = [];
    await act(async () => {
      results = await result.current.createContainer({
        dataConnection: null,
        pvcMounts: [],
      });
    });

    expect(abortCalled).toBe(true);

    const abortEntry = results.find((r) => r.resource === 'Operation' && r.error === 'Aborted');
    expect(abortEntry).toBeDefined();
    expect(abortEntry?.success).toBe(false);

    // Deployment was created before abort — rollback DELETE should be issued
    const deleteCalls = (global.fetch as jest.Mock).mock.calls.filter(
      (call: [string, RequestInit]) => call[1]?.method === 'DELETE',
    );
    expect(deleteCalls.length).toBeGreaterThan(0);
    expect(deleteCalls.some((call: [string]) => call[0].includes('deployments'))).toBe(true);
  });
});
