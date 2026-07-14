import { S3Client } from '@aws-sdk/client-s3';
import { NodeJsClient } from '@smithy/types';
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { getApplyMd5BodyChecksumPlugin } from '@aws-sdk/middleware-apply-body-checksum';
import http from 'http';
import https from 'https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

let accessKeyId = process.env.AWS_ACCESS_KEY_ID || '';
let secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || '';
let region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
let endpoint = process.env.AWS_S3_ENDPOINT || '';
let defaultBucket = process.env.AWS_S3_BUCKET || '';
let hfToken = process.env.HF_TOKEN || '';
let maxConcurrentTransfers = parseInt(process.env.MAX_CONCURRENT_TRANSFERS || '2', 10);
let maxFilesPerPage = parseInt(process.env.MAX_FILES_PER_PAGE || '100', 10);
let httpProxy = process.env.HTTP_PROXY || '';
let httpsProxy = process.env.HTTPS_PROXY || '';

export const DEFAULT_EPHEMERAL_PATH = '/opt/app-root/src/data';

let localStoragePaths: string[] = process.env.LOCAL_STORAGE_PATHS
  ? process.env.LOCAL_STORAGE_PATHS.split(',')
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  : [DEFAULT_EPHEMERAL_PATH];

let maxFileSizeGB: number = parseInt(process.env.MAX_FILE_SIZE_GB || '20', 10);
if (isNaN(maxFileSizeGB) || maxFileSizeGB <= 0) {
  maxFileSizeGB = 20;
}

export const initializeS3Client = (): S3Client => {
  const s3ClientOptions: any = {
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 5,
    retryMode: 'adaptive' as const,
  };

  const agentOptions: http.AgentOptions = {
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 10,
    maxFreeSockets: 5,
    timeout: 30000,
  };

  const agentConfig: {
    httpAgent?: HttpProxyAgent<string> | http.Agent;
    httpsAgent?: HttpsProxyAgent<string> | https.Agent;
  } = {};

  if (httpProxy) {
    try {
      agentConfig.httpAgent = new HttpProxyAgent<string>(httpProxy);
    } catch {
      // Fall back to standard agent
      agentConfig.httpAgent = new http.Agent(agentOptions);
    }
  } else {
    agentConfig.httpAgent = new http.Agent(agentOptions);
  }

  if (httpsProxy) {
    try {
      agentConfig.httpsAgent = new HttpsProxyAgent<string>(httpsProxy);
    } catch {
      agentConfig.httpsAgent = new https.Agent(agentOptions);
    }
  } else {
    agentConfig.httpsAgent = new https.Agent(agentOptions);
  }

  s3ClientOptions.requestHandler = new NodeHttpHandler({
    connectionTimeout: 5000,
    requestTimeout: 300000,
    httpAgent: agentConfig.httpAgent,
    httpsAgent: agentConfig.httpsAgent,
  });

  const client = new S3Client(s3ClientOptions) as NodeJsClient<S3Client>;
  // Minio requires Content-MD5 header for DELETE operations
  client.middlewareStack.use(getApplyMd5BodyChecksumPlugin(client.config) as any);

  return client;
};

let s3Client = initializeS3Client();

export const updateS3Config = (
  newAccessKeyId: string,
  newSecretAccessKey: string,
  newRegion: string,
  newEndpoint: string,
  newDefaultBucket: string,
): void => {
  accessKeyId = newAccessKeyId;
  secretAccessKey = newSecretAccessKey;
  region = newRegion;
  endpoint = newEndpoint;
  defaultBucket = newDefaultBucket;
  const oldClient = s3Client;
  s3Client = initializeS3Client();
  oldClient.destroy();
};

export const getS3Config = (): {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  endpoint: string;
  defaultBucket: string;
  s3Client: S3Client;
} => ({
  accessKeyId,
  secretAccessKey,
  region,
  endpoint,
  defaultBucket,
  s3Client,
});

export const getHFConfig = (): string => hfToken;

export const updateHFConfig = (newHfToken: string): void => {
  hfToken = newHfToken;
};

export const getProxyConfig = (): { httpProxy: string; httpsProxy: string } => ({
  httpProxy,
  httpsProxy,
});

export const updateProxyConfig = (newHttpProxy: string, newHttpsProxy: string): void => {
  httpProxy = newHttpProxy;
  httpsProxy = newHttpsProxy;
  const oldClient = s3Client;
  s3Client = initializeS3Client();
  oldClient.destroy();
};

export const getMaxConcurrentTransfers = (): number => maxConcurrentTransfers;

export const updateMaxConcurrentTransfers = (value: number): void => {
  maxConcurrentTransfers = value;
};

export const getMaxFilesPerPage = (): number => maxFilesPerPage;

export const updateMaxFilesPerPage = (value: number): void => {
  maxFilesPerPage = value;
};

export const getLocalStoragePaths = (): string[] => [...localStoragePaths];

export const getMaxFileSizeGB = (): number => maxFileSizeGB;

export const getMaxFileSizeBytes = (): number => maxFileSizeGB * 1024 * 1024 * 1024;

export const updateLocalStoragePaths = (newPaths: string[]): void => {
  localStoragePaths = newPaths.filter((p) => p.trim().length > 0);
};

export const updateMaxFileSizeGB = (newLimitGB: number): void => {
  if (newLimitGB > 0 && !isNaN(newLimitGB)) {
    maxFileSizeGB = newLimitGB;
  } else {
    throw new Error(`Invalid file size limit: ${newLimitGB}`);
  }
};

export const isFileSizeValid = (sizeBytes: number): boolean => sizeBytes <= getMaxFileSizeBytes();

export const hasEphemeralDefaultPath = (): boolean =>
  localStoragePaths.includes(DEFAULT_EPHEMERAL_PATH);

export const formatFileSize = (sizeBytes: number): string => {
  const gb = sizeBytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = sizeBytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  const kb = sizeBytes / 1024;
  return `${kb.toFixed(2)} KB`;
};
