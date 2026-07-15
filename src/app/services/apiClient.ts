const BFF_BASE = '/brewet/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new ApiError('Authentication required. Please log in again.', response.status, response.statusText);
    }
    if (response.status === 503) {
      throw new ApiError('Storage container is not running. Start the container to access storage.', response.status, response.statusText);
    }
    throw new ApiError(body || response.statusText, response.status, response.statusText);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return response.text() as unknown as T;
}

function buildUrl(namespace: string, path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${BFF_BASE}/${encodeURIComponent(namespace)}${cleanPath}`;
}

export const apiClient = {
  async get<T>(namespace: string, path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(buildUrl(namespace, path), { signal });
    return handleResponse<T>(response);
  },

  async post<T>(namespace: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(buildUrl(namespace, path), {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    return handleResponse<T>(response);
  },

  async put<T>(namespace: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(buildUrl(namespace, path), {
      method: 'PUT',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(namespace: string, path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(buildUrl(namespace, path), {
      method: 'DELETE',
      signal,
    });
    return handleResponse<T>(response);
  },

  async uploadFile(namespace: string, path: string, file: File, signal?: AbortSignal): Promise<Response> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(buildUrl(namespace, path), {
      method: 'POST',
      body: formData,
      signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ApiError(body || response.statusText, response.status, response.statusText);
    }
    return response;
  },

  getDownloadUrl(namespace: string, path: string): string {
    return buildUrl(namespace, path);
  },
};
