import { apiClient } from '~/app/services/apiClient';
import { base64Encode } from '~/app/utils/encoding';
import type {
  StorageLocation,
  BucketsList,
  LocalStorageLocation,
  FileListResponse,
  TransferRequest,
  TransferJob,
  ConflictCheckResult,
  S3Settings,
  HuggingFaceSettings,
  ProxySettings,
  ConnectionTestResult,
  HuggingFaceImportRequest,
  HuggingFaceImportResponse,
} from '~/app/types/storage';

class StorageService {
  private locationsCache: StorageLocation[] | null = null;
  private cacheNamespace: string | null = null;

  async getLocations(namespace: string, signal?: AbortSignal): Promise<StorageLocation[]> {
    if (this.locationsCache && this.cacheNamespace === namespace) {
      return this.locationsCache;
    }

    const [bucketsResult, localResult] = await Promise.allSettled([
      apiClient.get<BucketsList>(namespace, '/buckets', signal),
      apiClient.get<{ locations: LocalStorageLocation[] }>(namespace, '/local/locations', signal),
    ]);

    const locations: StorageLocation[] = [];

    if (bucketsResult.status === 'fulfilled') {
      const bucketsList = bucketsResult.value;
      for (const bucket of bucketsList.buckets) {
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
      for (const loc of localResult.value.locations) {
        locations.push({
          id: loc.id,
          name: loc.name,
          type: 'pvc',
          status: loc.available ? 'available' : 'unavailable',
          error: loc.error,
        });
      }
    }

    this.locationsCache = locations;
    this.cacheNamespace = namespace;
    return locations;
  }

  async refreshLocations(namespace: string, signal?: AbortSignal): Promise<StorageLocation[]> {
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
      return apiClient.get<FileListResponse>(namespace, query ? `${url}?${query}` : url, signal);
    }

    const encodedPath = base64Encode(path || '/');
    const url = `/local/files/${encodeURIComponent(location.id)}/${encodedPath}`;

    const params = new URLSearchParams();
    if (options?.limit != null) params.set('limit', String(options.limit));
    if (options?.offset != null) params.set('offset', String(options.offset));

    const query = params.toString();
    return apiClient.get<FileListResponse>(namespace, query ? `${url}?${query}` : url, signal);
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
    return apiClient.get<S3Settings>(namespace, '/settings/s3', signal);
  }

  async updateS3Settings(namespace: string, settings: S3Settings, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/s3', settings, signal);
  }

  async testS3Connection(namespace: string, signal?: AbortSignal): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>(namespace, '/settings/test-s3', undefined, signal);
  }

  async getHuggingFaceSettings(namespace: string, signal?: AbortSignal): Promise<HuggingFaceSettings> {
    return apiClient.get<HuggingFaceSettings>(namespace, '/settings/huggingface', signal);
  }

  async updateHuggingFaceSettings(namespace: string, settings: HuggingFaceSettings, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/huggingface', settings, signal);
  }

  async testHuggingFaceConnection(namespace: string, signal?: AbortSignal): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>(namespace, '/settings/test-huggingface', undefined, signal);
  }

  async getProxySettings(namespace: string, signal?: AbortSignal): Promise<ProxySettings> {
    return apiClient.get<ProxySettings>(namespace, '/settings/proxy', signal);
  }

  async updateProxySettings(namespace: string, settings: ProxySettings, signal?: AbortSignal): Promise<void> {
    await apiClient.put(namespace, '/settings/proxy', settings, signal);
  }

  async testProxyConnection(namespace: string, signal?: AbortSignal): Promise<ConnectionTestResult> {
    return apiClient.post<ConnectionTestResult>(namespace, '/settings/test-proxy', undefined, signal);
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
}

export const storageService = new StorageService();
