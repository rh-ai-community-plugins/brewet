import { renderHook, act, waitFor } from '@testing-library/react';
import { BrewetProvider, useBrewetContext } from '../BrewetContext';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    json: () => Promise.resolve({}),
  });
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <BrewetProvider>{children}</BrewetProvider>;
}

describe('BrewetContext', () => {
  it('should throw when used outside provider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useBrewetContext())).toThrow(
      'useBrewetContext must be used within a BrewetProvider',
    );
  });

  it('should provide initial state with no selected project', () => {
    const { result } = renderHook(() => useBrewetContext(), { wrapper });
    expect(result.current.selectedProject).toBeNull();
    expect(result.current.containerStatus).toBe('none');
    expect(result.current.containerInfo).toBeNull();
  });

  it('should persist selected project to localStorage', async () => {
    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('my-project');
    });

    expect(result.current.selectedProject).toBe('my-project');
    expect(localStorage.getItem('brewet.selected-project')).toBe('my-project');
  });

  it('should restore selected project from localStorage', async () => {
    localStorage.setItem('brewet.selected-project', 'saved-project');

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedProject).toBe('saved-project');
    });
  });

  it('should clear localStorage when project is set to null', async () => {
    localStorage.setItem('brewet.selected-project', 'old-project');

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject(null);
    });

    expect(result.current.selectedProject).toBeNull();
    expect(localStorage.getItem('brewet.selected-project')).toBeNull();
  });

  it('should fetch container status when project is set', async () => {
    const mockDeployment = {
      metadata: {
        name: 'brewet-storage-backend',
        namespace: 'test-ns',
        creationTimestamp: '2025-01-01T00:00:00Z',
      },
      spec: { replicas: 1 },
      status: { readyReplicas: 1 },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockDeployment),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('test-ns');
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/namespaces/test-ns/deployments/brewet-storage-backend'),
      );
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('running');
      expect(result.current.containerInfo).toMatchObject({
        name: 'brewet-storage-backend',
        namespace: 'test-ns',
      });
    });
  });

  it('should set container status to none on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({}),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('no-container');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('none');
      expect(result.current.containerInfo).toBeNull();
    });
  });

  it('should set stopped status when replicas is 0', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
        spec: { replicas: 0 },
        status: { readyReplicas: 0 },
      }),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('stopped');
    });
  });
});
