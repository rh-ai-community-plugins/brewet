import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { promises as fs, createWriteStream, ReadStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { base64Decode } from '../../../utils/encoding';
import { sanitizeFilename } from '../../../utils/sanitize';
import {
  validatePath,
  getStorageLocations,
  listDirectory,
  createDirectory,
  deleteFileOrDirectory,
  getFileMetadata,
  streamFile,
  checkFileSize,
  SecurityError,
  NotFoundError,
  PermissionError,
  StorageError,
} from '../../../utils/localStorage';
import { getMaxFileSizeBytes } from '../../../utils/config';
import { validateFileType } from '../../../utils/fileValidation';

function handleError(error: any, reply: FastifyReply) {
  if (error instanceof SecurityError) {
    return reply.code(403).send({ error: 'Forbidden', message: error.message });
  }
  if (error instanceof NotFoundError) {
    return reply.code(404).send({ error: 'Not Found', message: error.message });
  }
  if (error instanceof PermissionError) {
    return reply.code(403).send({ error: 'Permission Denied', message: error.message });
  }
  if (error instanceof StorageError) {
    if (error.message.includes('Disk full')) {
      return reply.code(507).send({ error: 'Insufficient Storage', message: error.message });
    }
    if (error.message.includes('too large') || error.message.includes('File too large')) {
      return reply.code(413).send({ error: 'Payload Too Large', message: error.message });
    }
  }
  if (error.code === 'ENOENT') {
    return reply.code(404).send({ error: 'Not Found', message: error.message });
  }
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return reply.code(403).send({ error: 'Permission Denied', message: error.message });
  }
  return reply.code(500).send({ error: 'Internal Server Error', message: error.message });
}

export default async (fastify: FastifyInstance): Promise<void> => {
  // List configured storage locations with availability status
  fastify.get('/locations', async (req: FastifyRequest) => {
    const allLocations = await getStorageLocations(req.log);
    return { locations: allLocations };
  });

  // List files at the given path with pagination support
  fastify.get<{
    Params: { locationId: string; '*'?: string };
    Querystring: { limit?: string; offset?: string };
  }>('/files/:locationId/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { locationId } = req.params as any;
    const encodedPath = (req.params as any)['*'] || '';
    const query = req.query as any;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    const offset = query.offset ? parseInt(query.offset, 10) : 0;

    try {
      const relativePath = encodedPath ? base64Decode(encodedPath) : '';
      const absolutePath = await validatePath(locationId, relativePath);
      const { files, totalCount } = await listDirectory(absolutePath, limit, offset);

      let parentPath = null;
      if (relativePath) {
        const parent = path.dirname(relativePath);
        parentPath = parent === relativePath ? null : parent;
      }

      const filesWithFullPaths = files.map((file) => ({
        ...file,
        path: relativePath ? path.join(relativePath, file.path) : file.path,
      }));

      return { files: filesWithFullPaths, currentPath: relativePath, parentPath, totalCount };
    } catch (error: any) {
      return handleError(error, reply);
    }
  });

  // Upload a file with multipart streaming
  fastify.post<{
    Params: { locationId: string; '*'?: string };
  }>('/files/:locationId/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { locationId } = req.params as any;
    const encodedPath = (req.params as any)['*'] || '';

    try {
      const relativePath = encodedPath ? base64Decode(encodedPath) : '';
      const parentRelativePath = path.dirname(relativePath);

      if (parentRelativePath && parentRelativePath !== '.') {
        const basePath = await validatePath(locationId, '.');
        const normalizedParent = path.normalize(parentRelativePath);
        const parentAbsolutePath = path.join(basePath, normalizedParent);

        if (
          !parentAbsolutePath.startsWith(basePath + path.sep) &&
          parentAbsolutePath !== basePath
        ) {
          throw new SecurityError(`Path escapes allowed directory: ${parentRelativePath}`);
        }

        await fs.mkdir(parentAbsolutePath, { recursive: true });

        const realParent = await fs.realpath(parentAbsolutePath);
        if (!realParent.startsWith(basePath + path.sep) && realParent !== basePath) {
          throw new SecurityError('Resolved parent path escapes allowed directory');
        }
      }

      const absolutePath = await validatePath(locationId, relativePath);

      let data;
      try {
        data = await req.file();
      } catch {
        return reply.code(400).send({ error: 'Bad Request', message: 'No file provided' });
      }

      if (!data) {
        return reply.code(400).send({ error: 'Bad Request', message: 'No file provided' });
      }

      const filename = path.basename(absolutePath);
      const { allowed, reason } = validateFileType(filename);
      if (!allowed) {
        return reply.code(400).send({ error: 'InvalidFileType', message: reason });
      }

      try {
        await fs.access(absolutePath);
        return reply.code(409).send({ error: 'Conflict', message: 'File already exists' });
      } catch {
        // File doesn't exist, continue with upload
      }

      let totalSize = 0;
      const maxSize = getMaxFileSizeBytes();

      try {
        await pipeline(
          data.file,
          new Transform({
            transform(chunk, _encoding, callback) {
              totalSize += chunk.length;
              if (totalSize > maxSize) {
                callback(new StorageError('File too large'));
              } else {
                callback(null, chunk);
              }
            },
          }),
          createWriteStream(absolutePath),
        );
      } catch (pipelineError) {
        try { await fs.unlink(absolutePath); } catch { /* ignore cleanup errors */ }
        throw pipelineError;
      }

      return { uploaded: true, path: relativePath };
    } catch (error: any) {
      return handleError(error, reply);
    }
  });

  // View a file inline (for preview)
  fastify.get<{
    Params: { locationId: string; '*'?: string };
  }>('/view/:locationId/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { locationId } = req.params as any;
    const encodedPath = (req.params as any)['*'] || '';

    try {
      const relativePath = encodedPath ? base64Decode(encodedPath) : '';
      const absolutePath = await validatePath(locationId, relativePath);
      await checkFileSize(absolutePath);
      const stream = await streamFile(absolutePath) as ReadStream;
      reply.raw.on('close', () => { stream.destroy(); });
      return stream;
    } catch (error: any) {
      return handleError(error, reply);
    }
  });

  // Download a file with streaming and proper headers
  fastify.get<{
    Params: { locationId: string; '*'?: string };
  }>('/download/:locationId/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { locationId } = req.params as any;
    const encodedPath = (req.params as any)['*'] || '';

    try {
      const relativePath = encodedPath ? base64Decode(encodedPath) : '';
      const absolutePath = await validatePath(locationId, relativePath);
      await checkFileSize(absolutePath);

      const metadata = await getFileMetadata(absolutePath);
      const stream = await streamFile(absolutePath) as ReadStream;

      reply.raw.on('close', () => { stream.destroy(); });

      reply
        .type('application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${sanitizeFilename(metadata.name)}"`)
        .header('Content-Length', metadata.size || 0)
        .send(stream);
    } catch (error: any) {
      return handleError(error, reply);
    }
  });

  // Delete a file or directory recursively
  fastify.delete<{
    Params: { locationId: string; '*'?: string };
  }>('/files/:locationId/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { locationId } = req.params as any;
    const encodedPath = (req.params as any)['*'] || '';

    try {
      const relativePath = encodedPath ? base64Decode(encodedPath) : '';
      const absolutePath = await validatePath(locationId, relativePath);
      const itemCount = await deleteFileOrDirectory(absolutePath);
      return { deleted: true, itemCount };
    } catch (error: any) {
      return handleError(error, reply);
    }
  });

  // Create a directory
  fastify.post<{
    Params: { locationId: string; '*'?: string };
  }>('/directories/:locationId/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const { locationId } = req.params as any;
    const encodedPath = (req.params as any)['*'] || '';

    try {
      const relativePath = encodedPath ? base64Decode(encodedPath) : '';
      const absolutePath = await validatePath(locationId, relativePath);
      await createDirectory(absolutePath);
      return { created: true, path: relativePath };
    } catch (error: any) {
      return handleError(error, reply);
    }
  });
};
