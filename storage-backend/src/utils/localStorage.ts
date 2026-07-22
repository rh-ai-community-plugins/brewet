import { promises as fs } from 'fs';
import path from 'path';
import { getLocalStoragePaths, getMaxFileSizeBytes } from './config';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  modified?: string;
  target?: string;
}

export interface StorageLocation {
  id: string;
  name: string;
  path: string;
  type: 'local';
  available: boolean;
}

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export async function validatePath(locationId: string, relativePath = ''): Promise<string> {
  // 1. Parse location index from ID
  const match = locationId.match(/^local-(\d+)$/);
  if (!match) {
    throw new NotFoundError(`Invalid location ID: ${locationId}`);
  }

  const index = parseInt(match[1], 10);
  const allowedPaths = getLocalStoragePaths();

  // 2. Check if index is valid
  if (index < 0 || index >= allowedPaths.length) {
    throw new NotFoundError(`Location index out of bounds: ${index}`);
  }

  const basePath = allowedPaths[index];

  // 3. Decode URL-encoded characters to prevent encoded traversal attacks
  let decodedPath = relativePath;
  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    decodedPath = relativePath;
  }

  // 4. Normalize Unicode to prevent normalization attacks
  const normalizedUnicode = decodedPath.normalize('NFC');

  // 5. Reject backslashes (Windows-style paths on Linux)
  if (normalizedUnicode.includes('\\')) {
    throw new SecurityError('Backslash characters not allowed in paths');
  }

  // 6. Reject null bytes
  if (normalizedUnicode.includes('\0')) {
    throw new SecurityError('Null bytes not allowed in paths');
  }

  // 7. Normalize and join paths
  const normalizedBase = path.normalize(basePath);
  const normalizedRelative = path.normalize(normalizedUnicode || '.');

  // 8. Reject absolute paths in relativePath
  if (path.isAbsolute(normalizedRelative)) {
    throw new SecurityError(`Absolute paths not allowed: ${relativePath}`);
  }

  // 9. Join and normalize
  const joinedPath = path.join(normalizedBase, normalizedRelative);

  // 10. Pre-flight check — detect obvious traversal attempts before filesystem access
  if (!joinedPath.startsWith(normalizedBase + path.sep) && joinedPath !== normalizedBase) {
    throw new SecurityError(`Path escapes allowed directory: ${relativePath}`);
  }

  // 11. Resolve symlinks and verify final path
  let resolvedPath: string;
  try {
    resolvedPath = await fs.realpath(joinedPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      const parentPath = path.dirname(joinedPath);
      try {
        const resolvedParent = await fs.realpath(parentPath);
        if (
          !resolvedParent.startsWith(normalizedBase + path.sep) &&
          resolvedParent !== normalizedBase
        ) {
          throw new SecurityError(`Path escapes allowed directory: ${relativePath}`);
        }
        return path.join(resolvedParent, path.basename(joinedPath));
      } catch (parentError: any) {
        if (parentError instanceof SecurityError) throw parentError;
        if (!parentPath.startsWith(normalizedBase + path.sep) && parentPath !== normalizedBase) {
          throw new SecurityError(`Path escapes allowed directory: ${relativePath}`);
        }
        throw new NotFoundError(`Parent directory not found: ${parentPath}`);
      }
    }
    if (error.code === 'EACCES') {
      throw new PermissionError(`Permission denied: ${joinedPath}`);
    }
    throw new StorageError(`Failed to resolve path: ${error.message}`);
  }

  if (!resolvedPath.startsWith(normalizedBase + path.sep) && resolvedPath !== normalizedBase) {
    throw new SecurityError(`Path escapes allowed directory: ${relativePath} -> ${resolvedPath}`);
  }

  return resolvedPath;
}

/**
 * Resolve a symlink target, redacting it if it points outside the allowed base directory.
 * Returns the raw readlink value when the resolved target is within basePath,
 * or undefined when it escapes (preventing information disclosure of external paths).
 */
async function resolveSymlinkTarget(
  entryPath: string,
  basePath?: string,
): Promise<string | undefined> {
  if (!basePath) {
    return fs.readlink(entryPath);
  }

  try {
    const resolvedTarget = await fs.realpath(entryPath);
    if (
      resolvedTarget.startsWith(basePath + path.sep) ||
      resolvedTarget === basePath
    ) {
      return fs.readlink(entryPath);
    }
  } catch {
    // Cannot resolve symlink target (e.g. dangling symlink) — redact
  }

  return undefined;
}

export async function getStorageLocations(logger?: any): Promise<StorageLocation[]> {
  const paths = getLocalStoragePaths();
  const locations: StorageLocation[] = [];

  for (let i = 0; i < paths.length; i++) {
    const dirPath = paths[i];
    let available = false;

    try {
      const stats = await fs.stat(dirPath);
      available = stats.isDirectory();
      if (!available && logger) {
        logger.warn({ path: dirPath }, `Path exists but is not a directory: ${dirPath}`);
      }
    } catch (error: any) {
      if (logger) {
        logger.warn(
          { path: dirPath, locationId: `local-${i}`, errorCode: error.code },
          `Local storage path not accessible: ${dirPath}`,
        );
      }
    }

    locations.push({
      id: `local-${i}`,
      name: path.basename(dirPath) || dirPath,
      path: dirPath,
      type: 'local',
      available,
    });
  }

  return locations;
}

export async function listDirectory(
  absolutePath: string,
  limit?: number,
  offset = 0,
  basePath?: string,
): Promise<{ files: FileEntry[]; totalCount: number }> {
  try {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const files: FileEntry[] = [];

    for (const entry of entries) {
      const entryPath = path.join(absolutePath, entry.name);

      const fileEntry: FileEntry = {
        name: entry.name,
        path: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
      };

      if (entry.isFile() || entry.isSymbolicLink()) {
        try {
          const stats = await fs.stat(entryPath);
          fileEntry.size = stats.size;
          fileEntry.modified = stats.mtime.toISOString();
          if (entry.isSymbolicLink()) {
            fileEntry.target = await resolveSymlinkTarget(entryPath, basePath);
          }
        } catch {
          continue;
        }
      }

      files.push(fileEntry);
    }

    files.sort((a, b) => {
      if (a.type === 'directory' && b.type !== 'directory') return -1;
      if (a.type !== 'directory' && b.type === 'directory') return 1;
      return a.name.localeCompare(b.name);
    });

    const totalCount = files.length;

    if (limit !== undefined) {
      return { files: files.slice(offset, offset + limit), totalCount };
    }

    return { files, totalCount };
  } catch (error: any) {
    if (error.code === 'EACCES') {
      throw new PermissionError(`Permission denied: ${absolutePath}`);
    }
    if (error.code === 'ENOTDIR') {
      throw new StorageError(`Not a directory: ${absolutePath}`);
    }
    throw new StorageError(`Failed to list directory: ${error.message}`);
  }
}

export async function createDirectory(absolutePath: string): Promise<void> {
  try {
    await fs.mkdir(absolutePath, { recursive: true });
  } catch (error: any) {
    if (error.code === 'EACCES') {
      throw new PermissionError(`Permission denied: ${absolutePath}`);
    }
    if (error.code === 'ENOSPC') {
      throw new StorageError('Disk full');
    }
    throw new StorageError(`Failed to create directory: ${error.message}`);
  }
}

export async function deleteFileOrDirectory(absolutePath: string): Promise<number> {
  try {
    const stats = await fs.stat(absolutePath);

    if (stats.isDirectory()) {
      const entries = await fs.readdir(absolutePath, { recursive: true });
      const count = entries.length + 1;
      await fs.rm(absolutePath, { recursive: true, force: true });
      return count;
    } else {
      await fs.unlink(absolutePath);
      return 1;
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new NotFoundError(`File not found: ${absolutePath}`);
    }
    if (error.code === 'EACCES') {
      throw new PermissionError(`Permission denied: ${absolutePath}`);
    }
    throw new StorageError(`Failed to delete: ${error.message}`);
  }
}

export async function getFileMetadata(absolutePath: string, basePath?: string): Promise<FileEntry> {
  try {
    const stats = await fs.lstat(absolutePath);
    const name = path.basename(absolutePath);

    const entry: FileEntry = {
      name,
      path: name,
      type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : 'file',
      size: stats.size,
      modified: stats.mtime.toISOString(),
    };

    if (stats.isSymbolicLink()) {
      entry.target = await resolveSymlinkTarget(absolutePath, basePath);
    }

    return entry;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new NotFoundError(`File not found: ${absolutePath}`);
    }
    if (error.code === 'EACCES') {
      throw new PermissionError(`Permission denied: ${absolutePath}`);
    }
    throw new StorageError(`Failed to get metadata: ${error.message}`);
  }
}

export async function streamFile(absolutePath: string): Promise<NodeJS.ReadableStream> {
  try {
    await fs.access(absolutePath, fs.constants.R_OK);
    const { createReadStream } = await import('fs');
    return createReadStream(absolutePath, { highWaterMark: 64 * 1024 });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new NotFoundError(`File not found: ${absolutePath}`);
    }
    if (error.code === 'EACCES') {
      throw new PermissionError(`Permission denied: ${absolutePath}`);
    }
    throw new StorageError(`Failed to stream file: ${error.message}`);
  }
}

export async function checkFileSize(absolutePath: string): Promise<void> {
  try {
    const stats = await fs.stat(absolutePath);
    const maxSize = getMaxFileSizeBytes();

    if (stats.size > maxSize) {
      const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
      const limitGB = (maxSize / (1024 * 1024 * 1024)).toFixed(2);
      throw new StorageError(`File size ${sizeGB}GB exceeds limit of ${limitGB}GB`);
    }
  } catch (error: any) {
    if (error instanceof StorageError) throw error;
    if (error.code === 'ENOENT') {
      throw new NotFoundError(`File not found: ${absolutePath}`);
    }
    throw new StorageError(`Failed to check file size: ${error.message}`);
  }
}
