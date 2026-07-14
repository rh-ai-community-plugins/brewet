import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import http from 'http';
import https from 'https';
import { createWriteStream } from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PassThrough, Readable } from 'stream';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { base64Decode } from '../../../utils/encoding';
import { getS3Config, getMaxFileSizeBytes, getHFConfig, getProxyConfig } from '../../../utils/config';
import { validatePath } from '../../../utils/localStorage';
import {
  validateBucketName,
  validateContinuationToken,
  validateQuery,
  validateAndDecodePrefix,
} from '../../../utils/validation';
import { validateFileType } from '../../../utils/fileValidation';
import { sanitizeFilename } from '../../../utils/sanitize';
import { handleS3Error } from '../../../utils/s3-errors';
import { createProgressTransform, uploadWithCleanup } from '../../../utils/streamHelpers';
import { transferQueue, TransferFileJob } from '../../../utils/transferQueue';

const DEFAULT_MAX_KEYS = 500;
const MAX_ALLOWED_KEYS = 2000;
const MAX_CONTAINS_SCAN_PAGES = 5;

interface FilterMeta {
  q?: string;
  mode?: 'startsWith' | 'contains';
  partialResult?: boolean;
  scanPages?: number;
  scanStoppedReason?: 'maxKeysReached' | 'bucketExhausted' | 'scanCap';
  autoBroaden?: boolean;
  originalMode?: 'startsWith';
  matches?: {
    objects: Record<string, [number, number][]>;
    prefixes: Record<string, [number, number][]>;
  };
}

interface EnhancedResult {
  objects: any[] | undefined;
  prefixes: any[] | undefined;
  nextContinuationToken: string | null;
  isTruncated: boolean;
  filter?: FilterMeta;
}

const normalizeMaxKeys = (raw?: any): number => {
  const n = parseInt(raw, 10);
  if (isNaN(n)) return DEFAULT_MAX_KEYS;
  return Math.min(Math.max(1, n), MAX_ALLOWED_KEYS);
};

const applyFilter = (
  Contents: any[] | undefined,
  CommonPrefixes: any[] | undefined,
  qLower: string,
  mode: 'startsWith' | 'contains' = 'contains',
) => {
  const matchFn =
    mode === 'startsWith'
      ? (text: string) => text.toLowerCase().startsWith(qLower)
      : (text: string) => text.toLowerCase().includes(qLower);

  const filteredObjects = Contents?.filter((o) => {
    const key: string = o.Key || '';
    const last = key.split('/').pop() || key;
    return matchFn(last);
  });
  const filteredPrefixes = CommonPrefixes?.filter((p) => {
    const pref: string = p.Prefix || '';
    const last = pref.endsWith('/') ? pref.slice(0, -1).split('/').pop() : pref.split('/').pop();
    return matchFn(last || '');
  });
  return { filteredObjects, filteredPrefixes };
};

const computeMatchRanges = (leaf: string, qLower: string): [number, number][] => {
  const ranges: [number, number][] = [];
  if (!qLower) return ranges;
  const leafLower = leaf.toLowerCase();
  let idx = 0;
  while (idx <= leafLower.length) {
    const found = leafLower.indexOf(qLower, idx);
    if (found === -1) break;
    ranges.push([found, found + qLower.length]);
    idx = found + 1;
  }
  return ranges;
};

const addMatchMetadata = (
  objects: any[] | undefined,
  prefixes: any[] | undefined,
  qLower: string,
): FilterMeta['matches'] => {
  const objMatches: Record<string, [number, number][]> = {};
  const prefMatches: Record<string, [number, number][]> = {};
  if (objects) {
    for (const o of objects) {
      const key: string = o.Key || '';
      const leaf = key.split('/').pop() || key;
      const ranges = computeMatchRanges(leaf, qLower);
      if (ranges.length) objMatches[key] = ranges;
    }
  }
  if (prefixes) {
    for (const p of prefixes) {
      const pref: string = p.Prefix || '';
      const leaf = (pref.endsWith('/') ? pref.slice(0, -1) : pref).split('/').pop() || pref;
      const ranges = computeMatchRanges(leaf, qLower);
      if (ranges.length) prefMatches[pref] = ranges;
    }
  }
  return { objects: objMatches, prefixes: prefMatches };
};

const runContainsScan = async (
  s3Client: any,
  bucketName: string,
  decoded_prefix: string | undefined,
  continuationToken: string | undefined,
  qLower: string,
  effectiveMaxKeys: number,
  mode: 'startsWith' | 'contains' = 'contains',
) => {
  let nextToken: string | undefined = continuationToken || undefined;
  let aggregatedObjects: any[] = [];
  const aggregatedPrefixes: any[] = [];
  let underlyingTruncated = false;
  let lastUnderlyingToken: string | undefined = undefined;
  let pagesScanned = 0;

  while (pagesScanned < MAX_CONTAINS_SCAN_PAGES) {
    const page = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Delimiter: '/',
        Prefix: decoded_prefix || undefined,
        ContinuationToken: nextToken,
        MaxKeys: DEFAULT_MAX_KEYS,
      }),
    );
    pagesScanned += 1;
    const { filteredObjects, filteredPrefixes } = applyFilter(
      page.Contents,
      page.CommonPrefixes,
      qLower,
      mode,
    );
    if (filteredObjects) aggregatedObjects.push(...filteredObjects);
    if (filteredPrefixes) aggregatedPrefixes.push(...filteredPrefixes);
    underlyingTruncated = !!page.IsTruncated;
    lastUnderlyingToken = page.NextContinuationToken || undefined;

    if (aggregatedObjects.length >= effectiveMaxKeys) break;
    if (!underlyingTruncated || !page.NextContinuationToken) break;
    nextToken = page.NextContinuationToken;
  }

  if (aggregatedObjects.length > effectiveMaxKeys) {
    aggregatedObjects = aggregatedObjects.slice(0, effectiveMaxKeys);
  }

  let scanStoppedReason: 'maxKeysReached' | 'bucketExhausted' | 'scanCap';
  if (
    pagesScanned >= MAX_CONTAINS_SCAN_PAGES &&
    underlyingTruncated &&
    aggregatedObjects.length < effectiveMaxKeys
  ) {
    scanStoppedReason = 'scanCap';
  } else if (aggregatedObjects.length >= effectiveMaxKeys) {
    scanStoppedReason = 'maxKeysReached';
  } else {
    scanStoppedReason = 'bucketExhausted';
  }

  const morePossible =
    underlyingTruncated &&
    (aggregatedObjects.length >= effectiveMaxKeys || scanStoppedReason === 'scanCap');
  const responseToken = morePossible ? lastUnderlyingToken || null : null;

  return {
    aggregatedObjects,
    aggregatedPrefixes,
    morePossible,
    responseToken,
    pagesScanned,
    scanStoppedReason,
  };
};

export default async (fastify: FastifyInstance): Promise<void> => {
  const handleListRequest = async (
    req: FastifyRequest,
    reply: FastifyReply,
    bucketName: string,
    encodedPrefix: string | undefined,
  ) => {
    const { s3Client } = getS3Config();
    const { continuationToken, q, mode, maxKeys, autoBroaden } = (req.query || {}) as any;

    const bucketError = validateBucketName(bucketName);
    if (bucketError) {
      return reply.code(400).send({ error: 'InvalidBucketName', message: bucketError });
    }

    const tokenError = validateContinuationToken(continuationToken);
    if (tokenError) {
      return reply.code(400).send({ error: 'InvalidContinuationToken', message: tokenError });
    }

    const queryError = validateQuery(q);
    if (queryError) {
      return reply.code(400).send({ error: 'InvalidQuery', message: queryError });
    }

    const { decoded: decoded_prefix, error: prefixError } = validateAndDecodePrefix(encodedPrefix);
    if (prefixError) {
      return reply.code(400).send({ error: 'InvalidPrefix', message: prefixError });
    }

    const effectiveMaxKeys = normalizeMaxKeys(maxKeys);
    const requestedMode: 'startsWith' | 'contains' | undefined = q
      ? mode === 'startsWith'
        ? 'startsWith'
        : 'contains'
      : undefined;

    if (!q) {
      try {
        const { Contents, CommonPrefixes, NextContinuationToken, IsTruncated } =
          await s3Client.send(
            new ListObjectsV2Command({
              Bucket: bucketName,
              Delimiter: '/',
              Prefix: decoded_prefix || undefined,
              ContinuationToken: continuationToken || undefined,
              MaxKeys: effectiveMaxKeys,
            }),
          );
        return reply.send({
          objects: Contents,
          prefixes: CommonPrefixes,
          nextContinuationToken: NextContinuationToken || null,
          isTruncated: !!IsTruncated,
        } as EnhancedResult);
      } catch (err) {
        return handleS3Error(err, reply);
      }
    }

    const qLower = (q as string).toLowerCase();

    if (requestedMode === 'startsWith') {
      try {
        const { Contents, CommonPrefixes, NextContinuationToken, IsTruncated } =
          await s3Client.send(
            new ListObjectsV2Command({
              Bucket: bucketName,
              Delimiter: '/',
              Prefix: decoded_prefix || undefined,
              ContinuationToken: continuationToken || undefined,
              MaxKeys: effectiveMaxKeys,
            }),
          );
        const { filteredObjects, filteredPrefixes } = applyFilter(
          Contents,
          CommonPrefixes,
          qLower,
          requestedMode,
        );

        const shouldBroaden =
          autoBroaden === 'true' &&
          (!filteredObjects || filteredObjects.length === 0) &&
          (!filteredPrefixes || filteredPrefixes.length === 0);

        if (shouldBroaden) {
          const scan = await runContainsScan(
            s3Client,
            bucketName,
            decoded_prefix,
            continuationToken,
            qLower,
            effectiveMaxKeys,
            requestedMode,
          );
          const matches = addMatchMetadata(scan.aggregatedObjects, scan.aggregatedPrefixes, qLower);
          return reply.send({
            objects: scan.aggregatedObjects,
            prefixes: scan.aggregatedPrefixes,
            nextContinuationToken: scan.responseToken,
            isTruncated: scan.morePossible,
            filter: {
              q,
              mode: 'contains',
              originalMode: 'startsWith',
              autoBroaden: true,
              partialResult: scan.morePossible,
              scanPages: scan.pagesScanned,
              scanStoppedReason: scan.scanStoppedReason,
              matches,
            },
          } as EnhancedResult);
        }

        const matches = addMatchMetadata(filteredObjects, filteredPrefixes, qLower);
        return reply.send({
          objects: filteredObjects,
          prefixes: filteredPrefixes,
          nextContinuationToken: NextContinuationToken || null,
          isTruncated: !!IsTruncated,
          filter: { q, mode: 'startsWith', partialResult: false, matches },
        } as EnhancedResult);
      } catch (err) {
        return handleS3Error(err, reply);
      }
    }

    // contains mode
    try {
      const scan = await runContainsScan(
        s3Client,
        bucketName,
        decoded_prefix,
        continuationToken,
        qLower,
        effectiveMaxKeys,
        requestedMode || 'contains',
      );
      const matches = addMatchMetadata(scan.aggregatedObjects, scan.aggregatedPrefixes, qLower);
      return reply.send({
        objects: scan.aggregatedObjects,
        prefixes: scan.aggregatedPrefixes,
        nextContinuationToken: scan.responseToken,
        isTruncated: scan.morePossible,
        filter: {
          q,
          mode: 'contains',
          partialResult: scan.morePossible,
          scanPages: scan.pagesScanned,
          scanStoppedReason: scan.scanStoppedReason,
          matches,
        },
      } as EnhancedResult);
    } catch (err) {
      return handleS3Error(err, reply);
    }
  };

  // List objects at bucket root
  fastify.get('/:bucketName', async (req: FastifyRequest, reply: FastifyReply) => {
    const { bucketName } = req.params as { bucketName: string };
    await handleListRequest(req, reply, bucketName, undefined);
  });

  // List objects with prefix
  fastify.get('/:bucketName/:prefix', async (req: FastifyRequest, reply: FastifyReply) => {
    const { bucketName, prefix } = req.params as { bucketName: string; prefix: string };
    await handleListRequest(req, reply, bucketName, prefix);
  });

  // View an object inline
  fastify.get('/view/:bucketName/:encodedKey', async (req: FastifyRequest, reply: FastifyReply) => {
    const { s3Client } = getS3Config();
    const { bucketName, encodedKey } = req.params as { bucketName: string; encodedKey: string };

    const bucketError = validateBucketName(bucketName);
    if (bucketError) {
      return reply.code(400).send({ error: 'InvalidBucketName', message: bucketError });
    }

    const key = base64Decode(encodedKey);

    try {
      const item = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
      const s3Stream = item.Body as Readable;
      reply.raw.on('close', () => { s3Stream.destroy(); });
      return reply.send(s3Stream);
    } catch (err) {
      return handleS3Error(err, reply);
    }
  });

  // Download an object (streaming)
  fastify.get(
    '/download/:bucketName/:encodedKey',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { s3Client } = getS3Config();
      const { bucketName, encodedKey } = req.params as { bucketName: string; encodedKey: string };

      const bucketError = validateBucketName(bucketName);
      if (bucketError) {
        return reply.code(400).send({ error: 'InvalidBucketName', message: bucketError });
      }

      const key = base64Decode(encodedKey);
      const fileName = sanitizeFilename(key.split('/').pop() || 'download');

      try {
        const item = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        const s3Stream = item.Body as Readable;

        reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
        reply.header('Access-Control-Expose-Headers', 'Content-Disposition');
        reply.header('Content-Type', 'application/octet-stream');

        reply.raw.on('close', () => {
          s3Stream.destroy();
        });

        return reply.send(s3Stream);
      } catch (err) {
        return handleS3Error(err, reply);
      }
    },
  );

  // Delete an object or all objects with given prefix (folder)
  fastify.delete('/:bucketName/:encodedKey', async (req: FastifyRequest, reply: FastifyReply) => {
    const { s3Client } = getS3Config();
    const { bucketName, encodedKey } = req.params as { bucketName: string; encodedKey: string };

    const bucketError = validateBucketName(bucketName);
    if (bucketError) {
      return reply.code(400).send({ error: 'InvalidBucketName', message: bucketError });
    }

    const objectName = base64Decode(encodedKey);

    try {
      const objectsToDelete: { Key: string }[] = [];
      let token: string | undefined;

      do {
        const listResponse = await s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: objectName,
            ContinuationToken: token,
            MaxKeys: 1000,
          }),
        );

        if (listResponse.Contents && listResponse.Contents.length > 0) {
          objectsToDelete.push(...listResponse.Contents.map((item: any) => ({ Key: item.Key })));
        }

        token = listResponse.NextContinuationToken;
      } while (token);

      if (objectsToDelete.length === 0) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: objectName }));
        return reply.send({ message: 'Object deleted successfully' });
      }

      const batchSize = 1000;
      let totalDeleted = 0;

      for (let i = 0; i < objectsToDelete.length; i += batchSize) {
        const batch = objectsToDelete.slice(i, i + batchSize);
        await s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucketName,
            Delete: { Objects: batch, Quiet: true },
          }),
        );
        totalDeleted += batch.length;
      }

      return reply.send({
        message: `Successfully deleted ${totalDeleted} object(s)`,
        count: totalDeleted,
      });
    } catch (error) {
      return handleS3Error(error, reply);
    }
  });

  // Upload an object
  fastify.post(
    '/upload/:bucketName/:encodedKey',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { bucketName, encodedKey } = req.params as { bucketName: string; encodedKey: string };
      const { s3Client } = getS3Config();

      const bucketError = validateBucketName(bucketName);
      if (bucketError) {
        return reply.code(400).send({ error: 'InvalidBucketName', message: bucketError });
      }

      const key = base64Decode(encodedKey);
      const filename = key.split('/').pop() || key;
      const { allowed, reason } = validateFileType(filename);
      if (!allowed) {
        return reply.code(400).send({ error: 'InvalidFileType', message: reason });
      }

      let data;
      try {
        data = await req.file({
          limits: { fileSize: getMaxFileSizeBytes() },
        });
      } catch {
        return reply.status(400).send({ error: 'Bad Request', message: 'Invalid multipart request' });
      }

      if (!data) {
        return reply.status(400).send({ error: 'File not found', message: 'File not found in request' });
      }

      try {
        const upload = new Upload({
          client: s3Client,
          queueSize: 4,
          leavePartsOnError: false,
          params: { Bucket: bucketName, Key: key, Body: data.file },
        });

        await upload.done();
        return reply.send({ message: 'Object uploaded successfully' });
      } catch (e) {
        if (e instanceof S3ServiceException) {
          return reply.code(e.$metadata?.httpStatusCode || 500).send({
            error: e.name || 'S3ServiceException',
            message: e.message || 'An S3 service exception occurred.',
          });
        }
        const err = e as Error;
        if (err.name === 'AbortError') {
          return reply.code(499).send({ error: 'AbortError', message: 'Upload aborted by client' });
        }
        return reply.code(500).send({
          error: err.name || 'Unknown error',
          message: err.message || 'An unexpected error occurred.',
        });
      }
    },
  );

  // Create a folder (zero-byte object with trailing /)
  fastify.post(
    '/folder/:bucketName/:encodedKey',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { bucketName, encodedKey } = req.params as { bucketName: string; encodedKey: string };
      const { s3Client } = getS3Config();

      const bucketError = validateBucketName(bucketName);
      if (bucketError) {
        return reply.code(400).send({ error: 'InvalidBucketName', message: bucketError });
      }

      let key = base64Decode(encodedKey);
      if (!key.endsWith('/')) key += '/';

      try {
        const upload = new Upload({
          client: s3Client,
          params: { Bucket: bucketName, Key: key, Body: Buffer.alloc(0) },
        });

        await upload.done();
        return reply.send({ message: 'Folder created successfully' });
      } catch (error) {
        return handleS3Error(error, reply);
      }
    },
  );

  // HuggingFace model import
  fastify.post('/huggingface-import', async (req: FastifyRequest, reply: FastifyReply) => {
    interface HuggingFaceImportRequest {
      modelId: string;
      destinationType: 's3' | 'local';
      bucketName?: string;
      localLocationId?: string;
      localPath?: string;
      hfToken?: string;
      prefix?: string;
    }

    const body = req.body as HuggingFaceImportRequest;

    if (!body?.modelId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'modelId is required' });
    }

    if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(body.modelId) || body.modelId.length > 200) {
      return reply.code(400).send({ error: 'Bad Request', message: 'modelId must be in owner/model format' });
    }

    if (!body.destinationType || (body.destinationType !== 's3' && body.destinationType !== 'local')) {
      return reply.code(400).send({ error: 'Bad Request', message: 'destinationType must be s3 or local' });
    }

    if (body.destinationType === 's3' && !body.bucketName) {
      return reply.code(400).send({ error: 'Bad Request', message: 'bucketName is required for S3 destination' });
    }

    if (body.destinationType === 'local' && !body.localLocationId) {
      return reply.code(400).send({ error: 'Bad Request', message: 'localLocationId is required for local destination' });
    }

    const token = body.hfToken || getHFConfig();
    const { httpProxy, httpsProxy } = getProxyConfig();

    const BLOCKED_HOSTNAMES = [
      'localhost', '127.0.0.1', '::1', '0.0.0.0',
      'metadata.google.internal', '169.254.169.254',
      'kubernetes.default.svc', 'kubernetes.default',
    ];

    const isBlockedRedirect = (url: string): boolean => {
      try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        if (BLOCKED_HOSTNAMES.includes(hostname)) return true;
        if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return true;
        if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) return true;
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return true;
        return false;
      } catch {
        return true;
      }
    };

    const isHuggingFaceHost = (url: string): boolean => {
      try {
        return new URL(url).hostname.endsWith('huggingface.co');
      } catch {
        return false;
      }
    };

    const makeRequest = (
      url: string,
      callback: (res: http.IncomingMessage) => void,
      includeAuth = true,
    ): http.ClientRequest => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'brewet-storage-backend',
          ...(includeAuth && token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
      if (isHttps && httpsProxy) {
        try { options.agent = new HttpsProxyAgent(httpsProxy); } catch { /* no proxy */ }
      } else if (!isHttps && httpProxy) {
        try { options.agent = new HttpProxyAgent(httpProxy); } catch { /* no proxy */ }
      }
      return isHttps
        ? https.request(options, callback)
        : http.request(options, callback);
    };

    const fetchJSON = (url: string, includeAuth = true, redirectCount = 0): Promise<any> =>
      new Promise((resolve, reject) => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'));
          return;
        }
        const request = makeRequest(url, (res: http.IncomingMessage) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = res.headers.location;
            if (isBlockedRedirect(redirectUrl)) {
              reject(new Error('Redirect to blocked URL'));
              return;
            }
            const sendAuth = isHuggingFaceHost(redirectUrl);
            fetchJSON(redirectUrl, sendAuth, redirectCount + 1).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HuggingFace API returned ${res.statusCode}`));
            return;
          }
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON response')); }
          });
        }, includeAuth);
        request.on('error', reject);
        request.end();
      });

    const downloadFile = (
      url: string,
      redirectCount = 0,
      includeAuth = true,
    ): Promise<{ stream: Readable; contentLength: number }> =>
      new Promise((resolve, reject) => {
        if (redirectCount > 10) {
          reject(new Error('Too many redirects'));
          return;
        }
        const request = makeRequest(url, (res: http.IncomingMessage) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = res.headers.location;
            if (isBlockedRedirect(redirectUrl)) {
              reject(new Error('Redirect to blocked URL'));
              return;
            }
            const sendAuth = isHuggingFaceHost(redirectUrl);
            downloadFile(redirectUrl, redirectCount + 1, sendAuth).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Download failed with status ${res.statusCode}`));
            return;
          }
          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          resolve({ stream: res as unknown as Readable, contentLength });
        }, includeAuth);
        request.on('error', reject);
        request.end();
      });

    try {
      const modelInfo = await fetchJSON(`https://huggingface.co/api/models/${body.modelId}`);

      if (modelInfo.gated) {
        if (!token) {
          return reply.code(401).send({
            error: 'Authentication Required',
            message: 'This model is gated. Provide an HF token.',
          });
        }
        try {
          await fetchJSON('https://huggingface.co/api/whoami-v2');
        } catch {
          return reply.code(401).send({
            error: 'Authentication Failed',
            message: 'HF token is invalid or does not have access to this gated model.',
          });
        }
      }

      if (!modelInfo.siblings || !Array.isArray(modelInfo.siblings)) {
        return reply.code(404).send({
          error: 'Not Found',
          message: 'No files found in the model repository',
        });
      }

      const modelFiles = modelInfo.siblings as Array<{ rfilename: string }>;
      const prefix = body.prefix || body.modelId.replace('/', '_');

      const files: TransferFileJob[] = modelFiles.map((f) => ({
        sourcePath: f.rfilename,
        destinationPath: path.posix.join(prefix, f.rfilename),
        size: 0,
        status: 'pending' as const,
        loaded: 0,
      }));

      const executor = async (
        file: TransferFileJob,
        signal: AbortSignal,
        onProgress: (loaded: number) => void,
      ): Promise<void> => {
        if (signal.aborted) throw new Error('Cancelled');

        const url = `https://huggingface.co/${body.modelId}/resolve/main/${file.sourcePath}`;
        const { stream, contentLength } = await downloadFile(url);
        file.size = contentLength;

        if (signal.aborted) {
          stream.destroy();
          throw new Error('Cancelled');
        }

        if (body.destinationType === 's3') {
          const { s3Client } = getS3Config();
          const progressTransform = createProgressTransform(onProgress);
          const passThrough = new PassThrough();

          const cleanup = () => {
            stream.destroy();
            progressTransform.destroy();
            passThrough.destroy();
          };

          signal.addEventListener('abort', cleanup, { once: true });

          const pipelinePromise = pipeline(stream, progressTransform, passThrough);
          const upload = new Upload({
            client: s3Client,
            queueSize: 4,
            leavePartsOnError: false,
            params: {
              Bucket: body.bucketName!,
              Key: file.destinationPath,
              Body: passThrough,
            },
          });

          try {
            await Promise.all([pipelinePromise, uploadWithCleanup(upload)]);
          } finally {
            signal.removeEventListener('abort', cleanup);
          }
        } else {
          const destRelative = body.localPath
            ? path.join(body.localPath, file.destinationPath)
            : file.destinationPath;
          const destAbsolute = await validatePath(body.localLocationId!, destRelative);
          await fsPromises.mkdir(path.dirname(destAbsolute), { recursive: true });

          const progressTransform = createProgressTransform(onProgress);
          const writeStream = createWriteStream(destAbsolute);

          const cleanup = () => {
            stream.destroy();
            progressTransform.destroy();
            writeStream.destroy();
          };

          signal.addEventListener('abort', cleanup, { once: true });

          try {
            await pipeline(stream, progressTransform, writeStream);
          } finally {
            signal.removeEventListener('abort', cleanup);
          }
        }
      };

      const jobId = transferQueue.queueJob('huggingface', files, executor);

      return reply.send({
        jobId,
        sseUrl: `/api/transfer/progress/${jobId}`,
        fileCount: files.length,
        modelId: body.modelId,
      });
    } catch (err: unknown) {
      if (err instanceof S3ServiceException) {
        return handleS3Error(err, reply);
      }
      req.log.error(err, 'HuggingFace import failed');
      return reply.code(500).send({
        error: 'Import Error',
        message: err instanceof Error ? err.message : 'Failed to initiate HuggingFace import',
      });
    }
  });
};
