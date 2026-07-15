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

export interface TransferRequest {
  sourceType: StorageLocationType;
  sourceLocation: string;
  sourcePath: string;
  destinationType: StorageLocationType;
  destinationLocation: string;
  destinationPath: string;
  files: string[];
  conflictResolution?: 'overwrite' | 'skip' | 'rename';
}

export interface TransferJob {
  jobId: string;
  sseUrl: string;
  status?: 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
}

export interface ConflictCheckResult {
  conflicts: Array<{
    path: string;
    existsAtDestination: boolean;
  }>;
}

export interface S3Settings {
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  defaultBucket?: string;
}

export interface HuggingFaceSettings {
  token?: string;
}

export interface ProxySettings {
  httpProxy?: string;
  httpsProxy?: string;
  testUrl?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  message?: string;
  username?: string;
}
