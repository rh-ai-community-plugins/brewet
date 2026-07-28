const BFF_BASE = process.env.BFF_BASE_URL || '/brewet/api';

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

function extractErrorMessage(body: string, fallback: string): string {
  try {
    const json = JSON.parse(body);
    return json.message || json.detail || json.error || fallback;
  } catch {
    return body || fallback;
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 503) {
      throw new ApiError('Brewet is not running. Start Brewet to access storage.', response.status, response.statusText);
    }
    throw new ApiError(extractErrorMessage(body, response.statusText), response.status, response.statusText);
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
