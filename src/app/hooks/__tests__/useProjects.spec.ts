import { renderHook, waitFor, act } from '@testing-library/react';
import { useProjects } from '../useProjects';

const mockProjects = [
  { metadata: { name: 'project-a', uid: 'uid-a' }, status: { phase: 'Active' } },
  { metadata: { name: 'project-b', uid: 'uid-b' }, status: { phase: 'Active' } },
];

describe('useProjects', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should return projects on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: mockProjects }),
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toEqual(mockProjects);
    expect(result.current.error).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/k8s/apis/project.openshift.io/v1/projects',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('should return error on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.projects).toEqual([]);
    expect(result.current.error).toBe('Failed to fetch projects: 500');
  });

  it('should support refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ items: mockProjects }),
    });

    const { result } = renderHook(() => useProjects());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
