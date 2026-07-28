export type StorageLocationType = 's3' | 'pvc';

export interface StorageLocation {
  id: string;
  name: string;
  type: StorageLocationType;
  status: 'available' | 'unavailable' | 'error';
  creationDate?: string;
  error?: string;
}

export interface BucketInfo {
  Name: string;
  CreationDate?: string;
}

export interface BucketsList {
  buckets: BucketInfo[];
  owner?: { DisplayName?: string; ID?: string };
  defaultBucket?: string;
  s3Connected?: boolean;
}

export interface LocationsResult {
  locations: StorageLocation[];
  s3Connected: boolean;
}

export interface LocalStorageLocation {
  id: string;
  name: string;
  path: string;
  available: boolean;
  error?: string;
}

export interface FileInfo {
  name: string;
  isDirectory: boolean;
  size?: number;
  lastModified?: string;
  etag?: string;
}

export interface FileListResponse {
  files: FileInfo[];
  continuationToken?: string;
  isTruncated?: boolean;
  totalCount?: number;
}

/**
 * Raw S3 list objects response from the storage backend.
 * objects = AWS SDK Contents items, prefixes = CommonPrefixes items.
 */
export interface RawS3ListResponse {
  objects?: Array<{ Key?: string; Size?: number; LastModified?: string; ETag?: string }>;
  prefixes?: Array<{ Prefix?: string }>;
  nextContinuationToken?: string | null;
  isTruncated?: boolean;
}

/**
 * Raw local file entry from the storage backend.
 */
export interface RawLocalFileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modified?: string;
}

/**
 * Raw local file listing response from the storage backend.
 */
export interface RawLocalListResponse {
  files: RawLocalFileEntry[];
  currentPath?: string;
  parentPath?: string | null;
  totalCount?: number;
}

export interface TransferRequest {
  source: string;
  destination: string;
  items: Array<{ path: string; type: 'file' | 'directory' }>;
  conflictResolution?: 'overwrite' | 'skip' | 'rename';
  deleteSource?: boolean;
}

export interface TransferJob {
  jobId: string;
  sseUrl: string;
  fileCount: number;
  totalSize: number;
}

export interface ConflictCheckResult {
  conflicts: Array<{
    path: string;
    sourceSize: number;
    destinationSize: number;
  }>;
  nonConflicting: string[];
  warning?: string;
}

export interface S3Settings {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  defaultBucket?: string;
}

export interface HuggingFaceSettings {
  hfToken?: string;
}

export interface ProxySettings {
  httpProxy?: string;
  httpsProxy?: string;
}

export interface FileExtensionSettings {
  allowedExtensions?: string;
  blockedExtensions?: string;
}

export interface ConnectionTestResult {
  message: string;
  accessTokenDisplayName?: string;
}

export interface HuggingFaceImportRequest {
  modelId: string;
  destinationType: 's3' | 'local';
  bucketName?: string;
  localLocationId?: string;
  localPath?: string;
  hfToken?: string;
  prefix?: string;
  excludeExtensions?: string[];
}

export interface HuggingFaceImportResponse {
  jobId: string;
  sseUrl: string;
  fileCount: number;
  modelId: string;
}

export type TransferStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
export type TransferFileStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
export type TransferType = 's3-upload' | 's3-download' | 'local-upload' | 'cross-storage' | 'huggingface';

export interface TransferFileJob {
  sourcePath: string;
  destinationPath: string;
  size: number;
  status: TransferFileStatus;
  loaded: number;
  uploadLoaded?: number;
  error?: string;
}

export interface TransferProgress {
  jobId: string;
  status: TransferStatus;
  type: TransferType;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  cancelledFiles: number;
  totalBytes: number;
  loadedBytes: number;
  currentFile?: string;
  error?: string;
  files: TransferFileJob[];
}
