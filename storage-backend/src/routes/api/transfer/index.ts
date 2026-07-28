import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, createWriteStream } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { PassThrough, Readable } from 'stream';
import { getS3Config } from '../../../utils/config';
import { validatePath as resolveLocalPath } from '../../../utils/localStorage';
import { setupSSE, sendSSEEvent, setupKeepAlive } from '../../../utils/sse';
import { createProgressTransform, uploadWithCleanup } from '../../../utils/streamHelpers';
import {
  transferQueue,
  TransferFileJob,
  TransferJobDestination,
  TransferProgress,
} from '../../../utils/transferQueue';
import { validateBucketName } from '../../../utils/validation';

const LARGE_FOLDER_FILE_THRESHOLD = 1000;
const LARGE_FOLDER_SIZE_THRESHOLD = 10 * 1024 * 1024 * 1024; // 10 GB
const MAX_EXPANDED_FILES = 100_000;
const MAX_ITEMS_PER_REQUEST = 1000;

// AWS S3 single-part copy is limited to 5 GB per object
const S3_COPY_SIZE_LIMIT = 5 * 1024 * 1024 * 1024; // 5 GB
// Each part in a multipart copy must be at least 5 MB (except the last); 500 MB is a reasonable default
const MULTIPART_COPY_PART_SIZE = 500 * 1024 * 1024; // 500 MB

interface TransferItem {
  path: string;
  type: 'file' | 'directory';
}

interface TransferRequest {
  source: string;
  destination: string;
  items: TransferItem[];
  conflictResolution?: 'overwrite' | 'skip' | 'rename';
  deleteSource?: boolean;
}

interface ConflictCheckRequest {
  source: string;
  destination: string;
  items: TransferItem[];
}

interface ConflictEntry {
  path: string;
  sourceSize: number;
  destinationSize: number;
}

function parseTransferPath(transferPath: string): [string, string, string] {
  const colonIdx = transferPath.indexOf(':');
  if (colonIdx === -1) throw new Error(`Invalid transfer path format: ${transferPath}`);

  const type = transferPath.substring(0, colonIdx);
  const rest = transferPath.substring(colonIdx + 1);

  if (type !== 's3' && type !== 'local') {
    throw new Error(`Invalid storage type: ${type}`);
  }

  const slashIdx = rest.indexOf('/');
  if (slashIdx === -1) {
    return [type, rest, ''];
  }
  return [type, rest.substring(0, slashIdx), rest.substring(slashIdx + 1)];
}

async function listS3DirectoryRecursive(
  bucketName: string,
  prefix: string,
): Promise<{ key: string; size: number }[]> {
  const { s3Client } = getS3Config();
  const results: { key: string; size: number }[] = [];
  let token: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );

    if (response.Contents) {
      for (const obj of response.Contents) {
        if (obj.Key && !obj.Key.endsWith('.s3keep')) {
          results.push({ key: obj.Key, size: obj.Size || 0 });
        }
      }
    }

    if (results.length > MAX_EXPANDED_FILES) {
      throw new Error(`Directory listing exceeded ${MAX_EXPANDED_FILES} files`);
    }

    token = response.NextContinuationToken;
  } while (token);

  return results;
}

async function listLocalDirectoryRecursive(
  locationId: string,
  basePath: string,
): Promise<{ relativePath: string; size: number }[]> {
  const results: { relativePath: string; size: number }[] = [];

  async function recurse(currentRelative: string): Promise<void> {
    const absolutePath = await resolveLocalPath(locationId, currentRelative || '.');
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      const childRelative = currentRelative ? path.join(currentRelative, entry.name) : entry.name;

      if (entry.isDirectory()) {
        await recurse(childRelative);
      } else if (entry.isFile()) {
        if (results.length >= MAX_EXPANDED_FILES) {
          throw new Error(`Directory listing exceeded ${MAX_EXPANDED_FILES} files`);
        }
        const childAbsolute = await resolveLocalPath(locationId, childRelative);
        const stats = await fs.stat(childAbsolute);
        results.push({ relativePath: childRelative, size: stats.size });
      }
    }
  }

  await recurse(basePath);
  return results;
}

async function expandItemsToFiles(
  sourceType: string,
  sourceLocationId: string,
  sourcePath: string,
  items: TransferItem[],
  destType: string,
): Promise<TransferFileJob[]> {
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    throw new Error(`Too many items: ${items.length} exceeds limit of ${MAX_ITEMS_PER_REQUEST}`);
  }

  const files: TransferFileJob[] = [];

  for (const item of items) {
    const itemPath = sourcePath ? path.posix.join(sourcePath, item.path) : item.path;

    if (item.type === 'directory') {
      if (sourceType === 's3') {
        const prefix = itemPath.endsWith('/') ? itemPath : itemPath + '/';
        const s3Files = await listS3DirectoryRecursive(sourceLocationId, prefix);
        for (const f of s3Files) {
          const relPath = f.key.substring(prefix.length);
          if (!relPath) continue;
          files.push({
            sourcePath: f.key,
            destinationPath: path.posix.join(item.path, relPath),
            size: f.size,
            status: 'pending',
            loaded: 0,
          });
        }
        // For S3-source transfers, create .s3keep markers for empty S3 source prefixes
        if (destType === 's3' && s3Files.length === 0) {
          files.push({
            sourcePath: prefix,
            destinationPath: path.posix.join(item.path, '.s3keep'),
            size: 0,
            status: 'pending',
            loaded: 0,
          });
        }
      } else {
        const localFiles = await listLocalDirectoryRecursive(sourceLocationId, itemPath);
        for (const f of localFiles) {
          const relPath = itemPath ? f.relativePath.substring(itemPath.length + 1) : f.relativePath;
          files.push({
            sourcePath: f.relativePath,
            destinationPath: path.posix.join(item.path, relPath || f.relativePath),
            size: f.size,
            status: 'pending',
            loaded: 0,
          });
        }
        // For local→S3 transfers, create .s3keep markers for empty local directories
        if (destType === 's3' && localFiles.length === 0) {
          files.push({
            sourcePath: itemPath + '/',
            destinationPath: path.posix.join(item.path, '.s3keep'),
            size: 0,
            status: 'pending',
            loaded: 0,
          });
        }
      }
    } else {
      let size = 0;
      if (sourceType === 's3') {
        const { s3Client } = getS3Config();
        try {
          const head = await s3Client.send(
            new HeadObjectCommand({
              Bucket: sourceLocationId,
              Key: itemPath,
            }),
          );
          size = head.ContentLength || 0;
        } catch {
          size = 0;
        }
      } else {
        try {
          const absPath = await resolveLocalPath(sourceLocationId, itemPath);
          const stats = await fs.stat(absPath);
          size = stats.size;
        } catch {
          size = 0;
        }
      }

      files.push({
        sourcePath: itemPath,
        destinationPath: item.path,
        size,
        status: 'pending',
        loaded: 0,
      });
    }
  }

  return files;
}

async function retryNetworkOperation<T>(
  fn: () => Promise<T>,
  signal: AbortSignal,
  maxRetries = 3,
): Promise<T> {
  const retryableCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET'];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (signal.aborted) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !retryableCodes.includes(code) || attempt === maxRetries) {
        throw err;
      }
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Cancelled'));
        }, { once: true });
      });
    }
  }
  throw new Error('Retries exhausted');
}

async function transferS3ToS3(
  file: TransferFileJob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  sourceBucket: string,
  destBucket: string,
  destPath: string,
): Promise<void> {
  const { s3Client } = getS3Config();
  const destKey = destPath ? path.posix.join(destPath, file.destinationPath) : file.destinationPath;

  await retryNetworkOperation(async () => {
    if (signal.aborted) throw new Error('Cancelled');

    if (file.size === 0) {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: destBucket,
          Key: destKey,
          Body: Buffer.alloc(0),
        }),
      );
      onProgress(file.size);
    } else if (file.size <= S3_COPY_SIZE_LIMIT) {
      await s3Client.send(
        new CopyObjectCommand({
          Bucket: destBucket,
          Key: destKey,
          CopySource: `${sourceBucket}/${encodeURIComponent(file.sourcePath).replace(/%2F/g, '/')}`,
        }),
      );
      onProgress(file.size);
    } else {
      // Multipart copy for objects > 5 GB (AWS single-part copy limit)
      const createResponse = await s3Client.send(
        new CreateMultipartUploadCommand({
          Bucket: destBucket,
          Key: destKey,
        }),
      );
      const uploadId = createResponse.UploadId!;

      const parts: { PartNumber: number; ETag: string }[] = [];
      let offset = 0;
      let partNumber = 1;

      try {
        while (offset < file.size) {
          if (signal.aborted) throw new Error('Cancelled');

          const end = Math.min(offset + MULTIPART_COPY_PART_SIZE - 1, file.size - 1);

          const partResponse = await s3Client.send(
            new UploadPartCopyCommand({
              Bucket: destBucket,
              Key: destKey,
              CopySource: `${sourceBucket}/${encodeURIComponent(file.sourcePath).replace(/%2F/g, '/')}`,
              CopySourceRange: `bytes=${offset}-${end}`,
              UploadId: uploadId,
              PartNumber: partNumber,
            }),
          );

          parts.push({
            PartNumber: partNumber,
            ETag: partResponse.CopyPartResult!.ETag!,
          });

          onProgress(end - offset + 1);

          offset = end + 1;
          partNumber++;
        }

        await s3Client.send(
          new CompleteMultipartUploadCommand({
            Bucket: destBucket,
            Key: destKey,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts },
          }),
        );
      } catch (err: unknown) {
        // Best-effort abort to clean up the incomplete multipart upload on S3
        await s3Client
          .send(new AbortMultipartUploadCommand({ Bucket: destBucket, Key: destKey, UploadId: uploadId }))
          .catch(() => {});
        throw err;
      }
    }
  }, signal);
}

async function transferS3ToLocal(
  file: TransferFileJob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  sourceBucket: string,
  destLocationId: string,
  destPath: string,
): Promise<void> {
  if (file.sourcePath.endsWith('.s3keep')) return;

  const { s3Client } = getS3Config();
  const destRelative = destPath
    ? path.join(destPath, file.destinationPath)
    : file.destinationPath;

  const destAbsolute = await resolveLocalPath(destLocationId, destRelative);
  await fs.mkdir(path.dirname(destAbsolute), { recursive: true });

  await retryNetworkOperation(async () => {
    if (signal.aborted) throw new Error('Cancelled');

    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: sourceBucket, Key: file.sourcePath }),
    );
    const s3Body = response.Body as Readable;

    const progressTransform = createProgressTransform(onProgress);
    const writeStream = createWriteStream(destAbsolute);

    const cleanup = () => {
      s3Body.destroy();
      progressTransform.destroy();
      writeStream.destroy();
    };

    signal.addEventListener('abort', cleanup, { once: true });

    try {
      await pipeline(s3Body, progressTransform, writeStream);
    } catch (err: unknown) {
      await fs.unlink(destAbsolute).catch(() => {});
      throw err;
    } finally {
      signal.removeEventListener('abort', cleanup);
    }
  }, signal);
}

async function transferLocalToS3(
  file: TransferFileJob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  sourceLocationId: string,
  destBucket: string,
  destPath: string,
): Promise<void> {
  const { s3Client } = getS3Config();
  const destKey = destPath
    ? path.posix.join(destPath, file.destinationPath)
    : file.destinationPath;

  if (file.size === 0 && file.sourcePath.endsWith('/')) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: destBucket,
        Key: destKey.endsWith('.s3keep') ? destKey : destKey + '.s3keep',
        Body: Buffer.alloc(0),
      }),
    );
    onProgress(0);
    return;
  }

  const sourceAbsolute = await resolveLocalPath(sourceLocationId, file.sourcePath);

  await retryNetworkOperation(async () => {
    if (signal.aborted) throw new Error('Cancelled');

    const readStream = createReadStream(sourceAbsolute);
    const progressTransform = createProgressTransform(onProgress);
    const passThrough = new PassThrough();

    const cleanup = () => {
      readStream.destroy();
      progressTransform.destroy();
      passThrough.destroy();
    };

    signal.addEventListener('abort', cleanup, { once: true });

    const pipelinePromise = pipeline(readStream, progressTransform, passThrough);

    const upload = new Upload({
      client: s3Client,
      queueSize: 4,
      leavePartsOnError: false,
      params: { Bucket: destBucket, Key: destKey, Body: passThrough },
    });

    try {
      await Promise.all([pipelinePromise, uploadWithCleanup(upload)]);
    } finally {
      signal.removeEventListener('abort', cleanup);
    }
  }, signal);
}

async function transferLocalToLocal(
  file: TransferFileJob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
  sourceLocationId: string,
  destLocationId: string,
  destPath: string,
): Promise<void> {
  const sourceAbsolute = await resolveLocalPath(sourceLocationId, file.sourcePath);
  const destRelative = destPath
    ? path.join(destPath, file.destinationPath)
    : file.destinationPath;
  const destAbsolute = await resolveLocalPath(destLocationId, destRelative);

  await fs.mkdir(path.dirname(destAbsolute), { recursive: true });

  // Write to a temp file then atomic rename to reduce TOCTOU window with conflict resolution
  const tmpPath = `${destAbsolute}.${Date.now()}.tmp`;

  const readStream = createReadStream(sourceAbsolute);
  const progressTransform = createProgressTransform(onProgress);
  const writeStream = createWriteStream(tmpPath);

  const cleanup = () => {
    readStream.destroy();
    progressTransform.destroy();
    writeStream.destroy();
  };

  signal.addEventListener('abort', cleanup, { once: true });

  try {
    await pipeline(readStream, progressTransform, writeStream);
    await fs.rename(tmpPath, destAbsolute);
  } catch (err: unknown) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  } finally {
    signal.removeEventListener('abort', cleanup);
  }
}

// Best-effort check — not atomic with the subsequent write (TOCTOU). See issue #30.
async function checkDestinationExists(
  destType: string,
  destLocationId: string,
  destPath: string,
  filePath: string,
): Promise<{ exists: boolean; size: number }> {
  const fullPath = destPath ? path.posix.join(destPath, filePath) : filePath;

  if (destType === 's3') {
    const { s3Client } = getS3Config();
    try {
      const head = await s3Client.send(
        new HeadObjectCommand({ Bucket: destLocationId, Key: fullPath }),
      );
      return { exists: true, size: head.ContentLength || 0 };
    } catch {
      return { exists: false, size: 0 };
    }
  } else {
    try {
      const absPath = await resolveLocalPath(destLocationId, fullPath);
      const stats = await fs.stat(absPath);
      return { exists: true, size: stats.size };
    } catch {
      return { exists: false, size: 0 };
    }
  }
}

export default async (fastify: FastifyInstance): Promise<void> => {
  // Initiate a transfer
  fastify.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as TransferRequest;

    if (!body?.source || !body?.destination || !body?.items?.length) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'source, destination, and items are required',
      });
    }

    let sourceType: string, sourceLocationId: string, sourcePath: string;
    let destType: string, destLocationId: string, destPath: string;

    try {
      [sourceType, sourceLocationId, sourcePath] = parseTransferPath(body.source);
      [destType, destLocationId, destPath] = parseTransferPath(body.destination);
    } catch (err: unknown) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: err instanceof Error ? err.message : 'Invalid transfer path',
      });
    }

    if (sourceType === 's3') {
      const err = validateBucketName(sourceLocationId);
      if (err) return reply.code(400).send({ error: 'InvalidBucketName', message: err });
    }
    if (destType === 's3') {
      const err = validateBucketName(destLocationId);
      if (err) return reply.code(400).send({ error: 'InvalidBucketName', message: err });
    }

    let files: TransferFileJob[];
    try {
      files = await expandItemsToFiles(sourceType, sourceLocationId, sourcePath, body.items, destType);
    } catch (err: unknown) {
      return reply.code(500).send({
        error: 'Expansion Error',
        message: err instanceof Error ? err.message : 'Failed to expand transfer items',
      });
    }

    if (files.length === 0) {
      return reply.code(400).send({
        error: 'Empty Transfer',
        message: 'No files to transfer',
      });
    }

    const conflictResolution = body.conflictResolution || 'overwrite';

    const executor = async (
      file: TransferFileJob,
      signal: AbortSignal,
      onProgress: (loaded: number) => void,
    ): Promise<void> => {
      if (conflictResolution === 'skip') {
        const { exists } = await checkDestinationExists(destType, destLocationId, destPath, file.destinationPath);
        if (exists) {
          file.status = 'completed';
          onProgress(file.size);
          return;
        }
      } else if (conflictResolution === 'rename') {
        const { exists } = await checkDestinationExists(destType, destLocationId, destPath, file.destinationPath);
        if (exists) {
          const ext = path.extname(file.destinationPath);
          const base = file.destinationPath.substring(0, file.destinationPath.length - ext.length);
          file.destinationPath = `${base}_${Date.now()}${ext}`;
        }
      }

      if (sourceType === 's3' && destType === 's3') {
        await transferS3ToS3(file, signal, onProgress, sourceLocationId, destLocationId, destPath);
      } else if (sourceType === 's3' && destType === 'local') {
        await transferS3ToLocal(file, signal, onProgress, sourceLocationId, destLocationId, destPath);
      } else if (sourceType === 'local' && destType === 's3') {
        await transferLocalToS3(file, signal, onProgress, sourceLocationId, destLocationId, destPath);
      } else {
        await transferLocalToLocal(file, signal, onProgress, sourceLocationId, destLocationId, destPath);
      }

      if (body.deleteSource) {
        if (sourceType === 's3') {
          const { s3Client } = getS3Config();
          await s3Client.send(new DeleteObjectCommand({
            Bucket: sourceLocationId,
            Key: file.sourcePath,
          }));
        } else {
          const absPath = await resolveLocalPath(sourceLocationId, file.sourcePath);
          await fs.unlink(absPath);
        }
      }
    };

    const transferType =
      sourceType === 's3' && destType === 's3' ? 'cross-storage' as const :
      sourceType === 's3' && destType === 'local' ? 's3-download' as const :
      sourceType === 'local' && destType === 's3' ? 's3-upload' as const :
      'local-upload' as const;

    const destination: TransferJobDestination = {
      type: destType as 's3' | 'local',
      locationId: destLocationId,
      basePath: destPath,
    };

    const jobId = transferQueue.queueJob(transferType, files, executor, destination);

    return reply.send({
      jobId,
      sseUrl: `/api/transfer/progress/${jobId}`,
      fileCount: files.length,
      totalSize: files.reduce((sum, f) => sum + f.size, 0),
    });
  });

  // SSE progress endpoint
  fastify.get('/progress/:jobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };
    const job = transferQueue.getJob(jobId);

    if (!job) {
      return reply.code(404).send({ error: 'Not Found', message: 'Transfer job not found' });
    }

    setupSSE(reply);
    const stopKeepAlive = setupKeepAlive(reply.raw);

    const isTerminal = (status: string) =>
      status === 'completed' || status === 'failed' || status === 'cancelled';

    let ended = false;
    const endResponse = () => {
      if (ended) return;
      ended = true;
      cleanup();
      reply.raw.end();
    };

    const onProgress = (data: TransferProgress) => {
      if (data.jobId !== jobId) return;
      sendSSEEvent(reply.raw, 'progress', data);

      if (isTerminal(data.status)) {
        endResponse();
      }
    };

    const cleanup = () => {
      transferQueue.removeListener('progress', onProgress);
      stopKeepAlive();
    };

    // Attach listener BEFORE checking status to avoid missing terminal events
    transferQueue.on('progress', onProgress);
    req.raw.on('close', () => {
      cleanup();
      ended = true;
    });

    const progress = transferQueue.getProgress(jobId);
    if (progress) {
      sendSSEEvent(reply.raw, 'progress', progress);
      if (isTerminal(progress.status)) {
        endResponse();
        return;
      }
    }

    // Prevent Fastify from ending the response
    await new Promise<void>((resolve) => {
      req.raw.on('close', resolve);
    });
  });

  // Get job details
  fastify.get('/:jobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };
    const progress = transferQueue.getProgress(jobId);

    if (!progress) {
      return reply.code(404).send({ error: 'Not Found', message: 'Transfer job not found' });
    }

    return progress;
  });

  // Cancel a transfer
  fastify.delete('/:jobId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };
    const cancelled = transferQueue.cancelJob(jobId);

    if (!cancelled) {
      return reply.code(404).send({
        error: 'Not Found',
        message: 'Transfer job not found or already completed',
      });
    }

    return { cancelled: true, jobId };
  });

  // Cleanup destination files for a cancelled or failed job.
  fastify.post('/:jobId/cleanup', async (req: FastifyRequest, reply: FastifyReply) => {
    const { jobId } = req.params as { jobId: string };
    const job = transferQueue.getJob(jobId);

    if (!job) {
      return reply.code(404).send({ error: 'Not Found', message: 'Transfer job not found' });
    }

    if (job.status !== 'cancelled' && job.status !== 'failed') {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'Cleanup is only available for cancelled or failed jobs',
      });
    }

    if (!job.destination) {
      return reply.code(501).send({
        error: 'Not Implemented',
        message: 'This job was created without destination tracking; cleanup is unavailable',
      });
    }

    const { type: destType, locationId: destLocationId, basePath: destPath } = job.destination;

    const filesToClean = job.files.filter(
      (f) => f.status === 'completed' || (f.loaded > 0 && (f.status === 'cancelled' || f.status === 'failed')),
    );

    let deleted = 0;
    let errors = 0;

    for (const file of filesToClean) {
      if (destType === 's3') {
        const destKey = destPath ? path.posix.join(destPath, file.destinationPath) : file.destinationPath;
        try {
          const { s3Client } = getS3Config();
          await s3Client.send(new DeleteObjectCommand({ Bucket: destLocationId, Key: destKey }));
          deleted++;
        } catch (err: unknown) {
          fastify.log.warn({ err, key: destKey }, 'Failed to delete S3 object during cleanup');
          errors++;
        }
      } else {
        const destRelative = destPath ? path.join(destPath, file.destinationPath) : file.destinationPath;
        try {
          const absPath = await resolveLocalPath(destLocationId, destRelative);
          await fs.unlink(absPath);
          deleted++;
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT') {
            fastify.log.warn({ err, path: destRelative }, 'Failed to delete local file during cleanup');
            errors++;
          }
        }
      }
    }

    return { cleaned: deleted, errors, jobId };
  });

  // Check for conflicts before transfer
  fastify.post('/check-conflicts', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as ConflictCheckRequest;

    if (!body?.source || !body?.destination || !body?.items?.length) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: 'source, destination, and items are required',
      });
    }

    let sourceType: string, sourceLocationId: string, sourcePath: string;
    let destType: string, destLocationId: string, destPath: string;

    try {
      [sourceType, sourceLocationId, sourcePath] = parseTransferPath(body.source);
      [destType, destLocationId, destPath] = parseTransferPath(body.destination);
    } catch (err: unknown) {
      return reply.code(400).send({
        error: 'Bad Request',
        message: err instanceof Error ? err.message : 'Invalid transfer path',
      });
    }

    let files: TransferFileJob[];
    try {
      files = await expandItemsToFiles(sourceType, sourceLocationId, sourcePath, body.items, destType);
    } catch (err: unknown) {
      return reply.code(500).send({
        error: 'Expansion Error',
        message: err instanceof Error ? err.message : 'Failed to expand items',
      });
    }

    const conflicts: ConflictEntry[] = [];
    const nonConflicting: string[] = [];
    let warning: string | undefined;

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (files.length > LARGE_FOLDER_FILE_THRESHOLD) {
      warning = `Transfer contains ${files.length} files (>${LARGE_FOLDER_FILE_THRESHOLD}). This may take a while.`;
    } else if (totalSize > LARGE_FOLDER_SIZE_THRESHOLD) {
      const sizeGB = (totalSize / (1024 * 1024 * 1024)).toFixed(1);
      warning = `Transfer size is ${sizeGB} GB (>10 GB). This may take a while.`;
    }

    for (const file of files) {
      const { exists, size: destSize } = await checkDestinationExists(
        destType,
        destLocationId,
        destPath,
        file.destinationPath,
      );

      if (exists) {
        conflicts.push({
          path: file.destinationPath,
          sourceSize: file.size,
          destinationSize: destSize,
        });
      } else {
        nonConflicting.push(file.destinationPath);
      }
    }

    return { conflicts, nonConflicting, warning };
  });
};
