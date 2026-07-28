import { apiClient } from '~/app/services/apiClient';
import { base64Encode } from '~/app/utils/encoding';
import { buildSettingsSecret, SETTINGS_SECRET_NAME } from '~/app/utils/k8sResources';
import type { ContainerSettings } from '~/app/types/k8s';
import type {
  StorageLocation,
  BucketsList,
  LocationsResult,
  LocalStorageLocation,
  FileInfo,
  FileListResponse,
  RawS3ListResponse,
  RawLocalListResponse,
  TransferRequest,
  TransferJob,
  TransferProgress,
  ConflictCheckResult,
  S3Settings,
  HuggingFaceSettings,
  ProxySettings,
  ConnectionTestResult,
  HuggingFaceImportRequest,
  HuggingFaceImportResponse,
} from '~/app/types/storage';

/**
 * Transform a raw S3 list-objects response into a FileListResponse.
 *
 * The storage backend returns `{ objects, prefixes, nextContinuationToken, isTruncated }`
 * where `objects` are AWS SDK Contents items (Key, Size, LastModified, ETag) and
 * `prefixes` are CommonPrefixes items (Prefix). This maps them into FileInfo[].
 */
export function transformS3Response(raw: RawS3ListResponse): FileListResponse {
  const files: FileInfo[] = [];

  // Map prefixes (directories) first
  if (raw.prefixes) {
    for (const prefix of raw.prefixes) {
      const fullPrefix = prefix.Prefix || '';
      // Extract the folder name: "path/to/folder/" -> "folder"
      const trimmed = fullPrefix.endsWith('/') ? fullPrefix.slice(0, -1) : fullPrefix;
      const name = trimmed.split('/').pop() || trimmed;
      if (name) {
        files.push({
          name,
          isDirectory: true,
        });
      }
    }
  }

  // Map objects (files)
  if (raw.objects) {
    for (const obj of raw.objects) {
      const key = obj.Key || '';
      // Skip "folder marker" objects (zero-byte keys ending with /)
      if (key.endsWith('/')) continue;
      const name = key.split('/').pop() || key;
      if (name) {
        files.push({
          name,
          isDirectory: false,
          size: obj.Size,
          lastModified: obj.LastModified,
          etag: obj.ETag,
        });
      }
    }
  }

  return {
    files,
    continuationToken: raw.nextContinuationToken ?? undefined,
    isTruncated: raw.isTruncated,
  };
}

/**
 * Transform a raw local file listing response into a FileListResponse.
 *
 * The storage backend returns FileEntry objects with `{ name, path, type, size?, modified? }`
 * where `type` is 'file' | 'directory' | 'symlink'. This maps `type` to `isDirectory`
 * and `modified` to `lastModified`.
 */
export function transformLocalResponse(raw: RawLocalListResponse): FileListResponse {
  const files: FileInfo[] = raw.files.map((entry) => ({
    name: entry.name,
    isDirectory: entry.type === 'directory',
    size: entry.size,
    lastModified: entry.modified,
  }));

  return {
    files,
    totalCount: raw.totalCount,
  };
}

class StorageService {
  private locationsCache: LocationsResult | null = null;
  private cacheNamespace: string | null = null;

  async getLocations(namespace: string, signal?: AbortSignal): Promise<LocationsResult> {
    if (this.locationsCache && this.cacheNamespace === namespace) {
      return this.locationsCache;
    }

    const [bucketsResult, localResult] = await Promise.allSettled([
      apiClient.get<BucketsList>(namespace, '/buckets', signal),
      apiClient.get<{ locations: LocalStorageLocation[] }>(namespace, '/local/locations', signal),
    ]);

    const locations: StorageLocation[] = [];
    let s3Connected = false;

    if (bucketsResult.status === 'fulfilled') {
      s3Connected = bucketsResult.value?.s3Connected ?? false;
      const buckets = bucketsResult.value?.buckets ?? [];
      for (const bucket of buckets) {
        locations.push({
          id: bucket.Name,
          name: bucket.Name,
          type: 's3',
          status: 'available',
          creationDate: bucket.CreationDate,
        });
      }
    }

    if (localResult.status === 'fulfilled') {
      const localLocations = localResult.value?.locations ?? [];
      for (const loc of localLocations) {
        locations.push({
          id: loc.id,
          name: loc.name,
          type: 'pvc',
          status: loc.available ? 'available' : 'unavailable',
          error: loc.error,
        });
      }
    }

    const result: LocationsResult = { locations, s3Connected };
    if (locations.length > 0 || s3Connected) {
      this.locationsCache = result;
      this.cacheNamespace = namespace;
    }
    return result;
  }

  async refreshLocations(namespace: string, signal?: AbortSignal): Promise<LocationsResult> {
    this.locationsCache = null;
    this.cacheNamespace = null;
    return this.getLocations(namespace, signal);
  }

  async getBucketsList(namespace: string, signal?: AbortSignal): Promise<BucketsList> {
    return apiClient.get<BucketsList>(namespace, '/buckets', signal);
  }

  async createBucket(namespace: string, bucketName: string, signal?: AbortSignal): Promise<void> {
    await apiClient.post(namespace, '/buckets', { bucketName }, signal);
    this.locationsCache = null;
    this.cacheNamespace = null;
  }

  async deleteBucket(namespace: string, bucketName: string, signal?: AbortSignal): Promise<void> {
    await apiClient.delete(namespace, `/buckets/${encodeURIComponent(bucketName)}`, signal);
    this.locationsCache = null;
    this.cacheNamespace = null;
  }

  async listFiles(
    namespace: string,
    location: StorageLocation,
    path: string,
    options?: {
      continuationToken?: string;
      maxKeys?: number;
      limit?: number;
      offset?: number;
      search?: string;
      searchMode?: 'startsWith' | 'contains';
    },
    signal?: AbortSignal,
  ): Promise<FileListResponse> {
    if (location.type === 's3') {
      const encodedPath = path ? base64Encode(path) : '';
      const url = encodedPath
        ? `/objects/${encodeURIComponent(location.id)}/${encodedPath}`
        : `/objects/${encodeURIComponent(location.id)}`;

      const params = new URLSearchParams();
      if (options?.continuationToken) params.set('continuationToken', options.continuationToken);
      if (options?.maxKeys != null) params.set('maxKeys', String(options.maxKeys));
      if (options?.search) {
        params.set('q', options.search);
        if (options.searchMode) params.set('mode', options.searchMode);
      }

      const query = params.toString();
      const raw = await apiClient.get<RawS3ListResponse>(
        namespace,
        query ? `${url}?${query}` : url,
        signal,
      );
      return transformS3Response(raw);
    }

    const encodedPath = path ? base64Encode(path) : '';
    const url = encodedPath
      ? `/local/files/${encodeURIComponent(location.id)}/${encodedPath}`
      : `/local/files/${encodeURIComponent(location.id)}/`;

    const params = new URLSearchParams();
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));

    const query = params.toString();
    const raw = await apiClient.get<RawLocalListResponse>(
      namespace,
      query ? `${url}?${query}` : url,
      signal,
    );
    return transformLocalResponse(raw);
  }

  async uploadFile(
    namespace: string,
    location: StorageLocation,
    path: string,
    file: File,
    signal?: AbortSignal,
  ): Promise<Response> {
    const encodedPath = base64Encode(path);
    if (location.type === 's3') {
      return apiClient.uploadFile(
        namespace,
        `/objects/upload/${encodeURIComponent(location.id)}/${encodedPath}`,
        file,
        signal,
      );
    }
    return apiClient.uploadFile(
      namespace,
      `/local/files/${encodeURIComponent(location.id)}/${encodedPath}`,
      file,
      signal,
    );
  }

  async downloadFile(
    namespace: string,
    location: StorageLocation,
    path: string,
  ): Promise<string> {
    const encodedPath = base64Encode(path);
    if (location.type === 's3') {
      return apiClient.getDownloadUrl(
        namespace,
        `/objects/download/${encodeURIComponent(location.id)}/${encodedPath}`,
      );
    }
    return apiClient.getDownloadUrl(
      namespace,
      `/local/download/${encodeURIComponent(location.id)}/${encodedPath}`,
    );
  }

  async deleteFile(
    namespace: string,
    location: StorageLocation,
    path: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const encodedPath = base64Encode(path);
    if (location.type === 's3') {
      await apiClient.delete(
        namespace,
        `/objects/${encodeURIComponent(location.id)}/${encodedPath}`,
        signal,
      );
      return;
    }
    await apiClient.delete(
      namespace,
      `/local/files/${encodeURIComponent(location.id)}/${encodedPath}`,
      signal,
    );
  }

  async createFolder(
    namespace: string,
    location: StorageLocation,
    path: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const encodedPath = base64Encode(path);
    if (location.type === 's3') {
      await apiClient.post(
        namespace,
        `/objects/folder/${encodeURIComponent(location.id)}/${encodedPath}`,
        undefined,
        signal,
      );
      return;
    }
    await apiClient.post(
      namespace,
      `/local/directories/${encodeURIComponent(location.id)}/${encodedPath}`,
      undefined,
      signal,
    );
  }

  async viewFile(
    namespace: string,
    location: StorageLocation,
    path: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const encodedPath = base64Encode(path);
    if (location.type === 's3') {
      return apiClient.get<string>(
        namespace,
        `/objects/view/${encodeURIComponent(location.id)}/${encodedPath}`,
        signal,
      );
    }
    return apiClient.get<string>(
      namespace,
      `/local/view/${encodeURIComponent(location.id)}/${encodedPath}`,
      signal,
    );
  }

  async getS3Settings(namespace: string, signal?: AbortSignal): Promise<S3Settings> {
    const result = await apiClient.get<{ settings: S3Settings }>(namespace, '/settings/s3', signal);
    return result.settings;
  }

  async updateS3Settings(namespace: string, settings: S3Settings, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/s3', settings, signal);
  }

  async testS3Connection(
    namespace: string,
    settings: Pick<S3Settings, 'accessKeyId' | 'secretAccessKey' | 'region' | 'endpoint'>,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>(namespace, '/settings/test-s3', settings, signal);
  }

  async getHuggingFaceSettings(namespace: string, signal?: AbortSignal): Promise<HuggingFaceSettings> {
    const result = await apiClient.get<{ settings: HuggingFaceSettings }>(namespace, '/settings/huggingface', signal);
    return result.settings;
  }

  async updateHuggingFaceSettings(namespace: string, settings: HuggingFaceSettings, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/huggingface', settings, signal);
  }

  async testHuggingFaceConnection(
    namespace: string,
    settings: Pick<HuggingFaceSettings, 'hfToken'>,
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>(namespace, '/settings/test-huggingface', settings, signal);
  }

  async getProxySettings(namespace: string, signal?: AbortSignal): Promise<ProxySettings> {
    const result = await apiClient.get<{ settings: ProxySettings }>(namespace, '/settings/proxy', signal);
    return result.settings;
  }

  async updateProxySettings(namespace: string, settings: ProxySettings, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/proxy', settings, signal);
  }

  async testProxyConnection(
    namespace: string,
    params: { testUrl: string; httpProxy?: string; httpsProxy?: string },
    signal?: AbortSignal,
  ): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>(namespace, '/settings/test-proxy', params, signal);
  }

  async getMaxConcurrentTransfers(namespace: string, signal?: AbortSignal): Promise<number> {
    const result = await apiClient.get<{ maxConcurrentTransfers: number }>(namespace, '/settings/max-concurrent-transfers', signal);
    return result.maxConcurrentTransfers;
  }

  async updateMaxConcurrentTransfers(namespace: string, value: number, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/max-concurrent-transfers', { maxConcurrentTransfers: value }, signal);
  }

  async getMaxFilesPerPage(namespace: string, signal?: AbortSignal): Promise<number> {
    const result = await apiClient.get<{ maxFilesPerPage: number }>(namespace, '/settings/max-files-per-page', signal);
    return result.maxFilesPerPage;
  }

  async updateMaxFilesPerPage(namespace: string, value: number, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/max-files-per-page', { maxFilesPerPage: value }, signal);
  }

  async getFileExtensions(
    namespace: string,
    signal?: AbortSignal,
  ): Promise<{ allowedExtensions: string[]; blockedExtensions: string[] }> {
    return apiClient.get(namespace, '/settings/file-extensions', signal);
  }

  async updateFileExtensions(
    namespace: string,
    settings: { allowedExtensions: string[]; blockedExtensions: string[] },
    signal?: AbortSignal,
  ): Promise<void> {
    await apiClient.put(namespace, '/settings/file-extensions', settings, signal);
  }

  async importHuggingFace(
    namespace: string,
    request: HuggingFaceImportRequest,
    signal?: AbortSignal,
  ): Promise<HuggingFaceImportResponse> {
    return apiClient.post<HuggingFaceImportResponse>(
      namespace,
      '/objects/huggingface-import',
      request,
      signal,
    );
  }

  async initiateTransfer(
    namespace: string,
    request: TransferRequest,
    signal?: AbortSignal,
  ): Promise<TransferJob> {
    return apiClient.post<TransferJob>(namespace, '/transfer', request, signal);
  }

  async checkConflicts(
    namespace: string,
    request: Omit<TransferRequest, 'conflictResolution'>,
    signal?: AbortSignal,
  ): Promise<ConflictCheckResult> {
    return apiClient.post<ConflictCheckResult>(namespace, '/transfer/check-conflicts', request, signal);
  }

  async cancelTransfer(
    namespace: string,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<{ cancelled: boolean; jobId: string }> {
    return apiClient.delete(namespace, `/transfer/${encodeURIComponent(jobId)}`, signal);
  }

  async cleanupTransfer(
    namespace: string,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<{ cleaned: number; errors: number; jobId: string }> {
    return apiClient.post(namespace, `/transfer/${encodeURIComponent(jobId)}/cleanup`, undefined, signal);
  }

  async getTransferProgress(
    namespace: string,
    jobId: string,
    signal?: AbortSignal,
  ): Promise<TransferProgress> {
    return apiClient.get<TransferProgress>(namespace, `/transfer/${encodeURIComponent(jobId)}`, signal);
  }

  getTransferSseUrl(namespace: string, sseUrl: string): string {
    const path = sseUrl.replace(/^\/api/, '');
    return apiClient.getDownloadUrl(namespace, path);
  }

  async readSettingsSecret(
    namespace: string,
    signal?: AbortSignal,
  ): Promise<ContainerSettings> {
    const ns = encodeURIComponent(namespace);
    const res = await fetch(
      `/api/k8s/api/v1/namespaces/${ns}/secrets/${SETTINGS_SECRET_NAME}`,
      { signal },
    );
    if (res.status === 404) return {};
    if (!res.ok) throw new Error(`Failed to read settings: ${res.status}`);
    const secret = await res.json();
    const data: Record<string, string> = secret.data ?? {};
    const decode = (v: string) => atob(v);
    const settings: ContainerSettings = {};
    if (data.HF_TOKEN) settings.hfToken = decode(data.HF_TOKEN);
    if (data.HTTP_PROXY) settings.httpProxy = decode(data.HTTP_PROXY);
    if (data.HTTPS_PROXY) settings.httpsProxy = decode(data.HTTPS_PROXY);
    if (data.MAX_CONCURRENT_TRANSFERS) {
      const v = parseInt(decode(data.MAX_CONCURRENT_TRANSFERS), 10);
      if (!isNaN(v)) settings.maxConcurrentTransfers = v;
    }
    if (data.MAX_FILES_PER_PAGE) {
      const v = parseInt(decode(data.MAX_FILES_PER_PAGE), 10);
      if (!isNaN(v)) settings.maxFilesPerPage = v;
    }
    if (data.ALLOWED_FILE_EXTENSIONS) {
      settings.allowedFileExtensions = decode(data.ALLOWED_FILE_EXTENSIONS);
    }
    if (data.BLOCKED_FILE_EXTENSIONS) {
      settings.blockedFileExtensions = decode(data.BLOCKED_FILE_EXTENSIONS);
    }
    return settings;
  }

  async patchSettingsSecret(
    namespace: string,
    stringData: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<void> {
    const ns = encodeURIComponent(namespace);
    const current = await this.readSettingsSecret(namespace, signal);
    const merged: ContainerSettings = { ...current };
    if ('HF_TOKEN' in stringData) merged.hfToken = stringData.HF_TOKEN;
    if ('HTTP_PROXY' in stringData) merged.httpProxy = stringData.HTTP_PROXY;
    if ('HTTPS_PROXY' in stringData) merged.httpsProxy = stringData.HTTPS_PROXY;
    if ('MAX_CONCURRENT_TRANSFERS' in stringData) {
      merged.maxConcurrentTransfers = parseInt(stringData.MAX_CONCURRENT_TRANSFERS, 10);
    }
    if ('MAX_FILES_PER_PAGE' in stringData) {
      merged.maxFilesPerPage = parseInt(stringData.MAX_FILES_PER_PAGE, 10);
    }
    if ('ALLOWED_FILE_EXTENSIONS' in stringData) {
      merged.allowedFileExtensions = stringData.ALLOWED_FILE_EXTENSIONS;
    }
    if ('BLOCKED_FILE_EXTENSIONS' in stringData) {
      merged.blockedFileExtensions = stringData.BLOCKED_FILE_EXTENSIONS;
    }
    const body = buildSettingsSecret(namespace, merged);
    const url = `/api/k8s/api/v1/namespaces/${ns}/secrets/${SETTINGS_SECRET_NAME}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 404) {
      const createRes = await fetch(
        `/api/k8s/api/v1/namespaces/${ns}/secrets`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
      );
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => '');
        throw new Error(`Failed to create settings secret: ${createRes.status} ${text}`);
      }
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to save settings: ${res.status} ${text}`);
    }
  }
}

export const storageService = new StorageService();
