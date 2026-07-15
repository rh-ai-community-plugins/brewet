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
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
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

  it('should poll every 5s while container status is starting', async () => {
    jest.useFakeTimers();

    const startingDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
      spec: { replicas: 1 },
      status: { readyReplicas: 0 },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(startingDeployment),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('starting');
    });

    const callsBefore = (global.fetch as jest.Mock).mock.calls.length;

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(callsBefore);

    jest.useRealTimers();
  });

  it('should stop polling when status transitions from starting to running', async () => {
    jest.useFakeTimers();

    const startingDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
      spec: { replicas: 1 },
      status: { readyReplicas: 0 },
    };
    const runningDeployment = {
      ...startingDeployment,
      status: { readyReplicas: 1 },
    };

    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(startingDeployment) })
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(runningDeployment) });

    global.fetch = fetchMock;

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('starting');
    });

    // First interval poll fires — returns running
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('running');
    });

    const callsAfterRunning = fetchMock.mock.calls.length;

    // Advance another full interval — polling should be stopped, no new calls
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });

    await act(async () => {});

    expect(fetchMock.mock.calls.length).toBe(callsAfterRunning);

    jest.useRealTimers();
  });

  it('should populate envFrom, volumes, and volumeMounts from deployment spec', async () => {
    const mockDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'test-ns' },
      spec: {
        replicas: 1,
        template: {
          spec: {
            containers: [
              {
                envFrom: [{ secretRef: { name: 'my-dc-secret' } }],
                volumeMounts: [{ name: 'pvc-my-pvc', mountPath: '/data/my-pvc' }],
              },
            ],
            volumes: [{ name: 'pvc-my-pvc', persistentVolumeClaim: { claimName: 'my-pvc' } }],
          },
        },
      },
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
      expect(result.current.containerInfo).toMatchObject({
        envFrom: [{ secretRef: { name: 'my-dc-secret' } }],
        volumes: [{ name: 'pvc-my-pvc', persistentVolumeClaim: { claimName: 'my-pvc' } }],
        volumeMounts: [{ name: 'pvc-my-pvc', mountPath: '/data/my-pvc' }],
      });
    });
  });

  it('should transition to error after 60 poll iterations while starting', async () => {
    jest.useFakeTimers();

    const startingDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
      spec: { replicas: 1 },
      status: { readyReplicas: 0 },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(startingDeployment),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('starting');
    });

    // Advance through 60 intervals (the guard fires on the 61st tick)
    for (let i = 0; i < 61; i++) {
      await act(async () => {
        jest.advanceTimersByTime(5000);
      });
    }

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('error');
    });

    jest.useRealTimers();
  });

  it('should reset poll count when status changes away from starting', async () => {
    jest.useFakeTimers();

    const startingDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
      spec: { replicas: 1 },
      status: { readyReplicas: 0 },
    };
    const runningDeployment = { ...startingDeployment, status: { readyReplicas: 1 } };

    const fetchMock = jest.fn()
      // Initial fetch + a few polls → starting
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(startingDeployment) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(startingDeployment) })
      // Transitions to running
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(runningDeployment) })
      // Simulate going back to starting (e.g. manual restart)
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(startingDeployment) });

    global.fetch = fetchMock;

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    // Advance 2 intervals (poll count reaches 2)
    for (let i = 0; i < 2; i++) {
      await act(async () => { jest.advanceTimersByTime(5000); });
    }

    // Transition to running (poll count should reset to 0)
    await act(async () => { jest.advanceTimersByTime(5000); });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('running');
    });

    // Manually trigger a refresh that returns starting again
    await act(async () => {
      result.current.refreshContainerStatus();
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('starting');
    });

    // With the reset, we should have 60 full polls before erroring — not error yet after 1 tick
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(result.current.containerStatus).toBe('starting');

    jest.useRealTimers();
  });

  it('should detect ProgressDeadlineExceeded and transition to error early', async () => {
    const failedDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
      spec: { replicas: 1 },
      status: {
        readyReplicas: 0,
        conditions: [
          { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(failedDeployment),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('error');
    });
  });

  it('should detect ReplicaFailure and transition to error early', async () => {
    const failedDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'ns' },
      spec: { replicas: 1 },
      status: {
        readyReplicas: 0,
        conditions: [
          { type: 'ReplicaFailure', status: 'True', reason: 'FailedCreate' },
        ],
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(failedDeployment),
    });

    const { result } = renderHook(() => useBrewetContext(), { wrapper });

    await act(async () => {
      result.current.setSelectedProject('ns');
    });

    await waitFor(() => {
      expect(result.current.containerStatus).toBe('error');
    });
  });

  it('should default envFrom/volumes/volumeMounts to empty arrays when not present in deployment', async () => {
    const mockDeployment = {
      metadata: { name: 'brewet-storage-backend', namespace: 'test-ns' },
      spec: { replicas: 1, template: { spec: { containers: [] } } },
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
      expect(result.current.containerInfo).toMatchObject({
        envFrom: [],
        volumes: [],
        volumeMounts: [],
      });
    });
  });
});
