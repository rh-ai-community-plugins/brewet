import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'stream';
import { base64Decode } from '../../../utils/encoding';
import { getS3Config } from '../../../utils/config';
import {
  validateBucketName,
  validateContinuationToken,
  validateQuery,
  validateAndDecodePrefix,
} from '../../../utils/validation';

function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, '_');
}

function handleS3Error(error: unknown, reply: FastifyReply) {
  if (error instanceof S3ServiceException) {
    return reply.code(error.$metadata?.httpStatusCode || 500).send({
      error: error.name || 'S3ServiceException',
      message: error.message || 'An S3 service exception occurred.',
    });
  }
  const err = error as Error;
  return reply.code(500).send({
    error: err.name || 'Unknown error',
    message: err.message || 'An unexpected error occurred.',
  });
}

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
      return item.Body;
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

      let data;
      try {
        data = await req.file({
          limits: { fileSize: 10 * 1024 * 1024 * 1024 },
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
};
