import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import {
  validatePath,
  getStorageLocations,
  listDirectory,
  createDirectory,
  deleteFileOrDirectory,
  getFileMetadata,
  SecurityError,
  NotFoundError,
} from '../../src/utils/localStorage';
import { updateLocalStoragePaths } from '../../src/utils/config';

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brewet-test-'));
  updateLocalStoragePaths([tempDir]);
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('validatePath', () => {
  it('validates a path within bounds', async () => {
    const result = await validatePath('local-0', '.');
    expect(result).toBe(tempDir);
  });

  it('validates a subpath within bounds', async () => {
    const subDir = path.join(tempDir, 'subdir');
    await fs.mkdir(subDir);
    const result = await validatePath('local-0', 'subdir');
    expect(result).toBe(subDir);
  });

  it('rejects invalid location ID format', async () => {
    await expect(validatePath('invalid', '')).rejects.toThrow(NotFoundError);
  });

  it('rejects out-of-bounds location index', async () => {
    await expect(validatePath('local-99', '')).rejects.toThrow(NotFoundError);
  });

  it('rejects path traversal attempts', async () => {
    await expect(validatePath('local-0', '../../../etc/passwd')).rejects.toThrow(SecurityError);
  });

  it('rejects null bytes', async () => {
    await expect(validatePath('local-0', 'file\0name')).rejects.toThrow(SecurityError);
  });

  it('rejects backslashes', async () => {
    await expect(validatePath('local-0', 'path\\to\\file')).rejects.toThrow(SecurityError);
  });

  it('rejects absolute paths', async () => {
    await expect(validatePath('local-0', '/etc/passwd')).rejects.toThrow(SecurityError);
  });

  it('allows non-existent paths if parent exists', async () => {
    const result = await validatePath('local-0', 'newfile.txt');
    expect(result).toBe(path.join(tempDir, 'newfile.txt'));
  });

  it('rejects URL-encoded traversal', async () => {
    await expect(validatePath('local-0', '..%2F..%2Fetc%2Fpasswd')).rejects.toThrow(SecurityError);
  });
});

describe('getStorageLocations', () => {
  it('returns locations with availability status', async () => {
    const locations = await getStorageLocations();
    expect(locations).toHaveLength(1);
    expect(locations[0].id).toBe('local-0');
    expect(locations[0].available).toBe(true);
  });

  it('marks non-existent directories as unavailable', async () => {
    updateLocalStoragePaths(['/nonexistent/path']);
    const locations = await getStorageLocations();
    expect(locations[0].available).toBe(false);
  });
});

describe('listDirectory', () => {
  it('lists files and directories sorted correctly', async () => {
    await fs.mkdir(path.join(tempDir, 'dir-b'));
    await fs.mkdir(path.join(tempDir, 'dir-a'));
    await fs.writeFile(path.join(tempDir, 'file-b.txt'), 'b');
    await fs.writeFile(path.join(tempDir, 'file-a.txt'), 'a');

    const { files, totalCount } = await listDirectory(tempDir);
    expect(totalCount).toBe(4);
    // Directories first, alphabetically
    expect(files[0].name).toBe('dir-a');
    expect(files[0].type).toBe('directory');
    expect(files[1].name).toBe('dir-b');
    expect(files[1].type).toBe('directory');
    // Then files, alphabetically
    expect(files[2].name).toBe('file-a.txt');
    expect(files[2].type).toBe('file');
    expect(files[3].name).toBe('file-b.txt');
  });

  it('supports pagination', async () => {
    await fs.writeFile(path.join(tempDir, 'a.txt'), 'a');
    await fs.writeFile(path.join(tempDir, 'b.txt'), 'b');
    await fs.writeFile(path.join(tempDir, 'c.txt'), 'c');

    const { files, totalCount } = await listDirectory(tempDir, 2, 0);
    expect(files).toHaveLength(2);
    expect(totalCount).toBe(3);
  });
});

describe('createDirectory', () => {
  it('creates directories recursively', async () => {
    const newDir = path.join(tempDir, 'a', 'b', 'c');
    await createDirectory(newDir);
    const stats = await fs.stat(newDir);
    expect(stats.isDirectory()).toBe(true);
  });
});

describe('deleteFileOrDirectory', () => {
  it('deletes a file', async () => {
    const filePath = path.join(tempDir, 'delete-me.txt');
    await fs.writeFile(filePath, 'data');
    const count = await deleteFileOrDirectory(filePath);
    expect(count).toBe(1);
    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('deletes a directory recursively', async () => {
    const dirPath = path.join(tempDir, 'delete-dir');
    await fs.mkdir(dirPath);
    await fs.writeFile(path.join(dirPath, 'file1.txt'), 'a');
    await fs.writeFile(path.join(dirPath, 'file2.txt'), 'b');
    const count = await deleteFileOrDirectory(dirPath);
    expect(count).toBe(3); // 2 files + 1 directory
    await expect(fs.access(dirPath)).rejects.toThrow();
  });

  it('throws NotFoundError for missing path', async () => {
    await expect(deleteFileOrDirectory(path.join(tempDir, 'nope'))).rejects.toThrow(NotFoundError);
  });
});

describe('getFileMetadata', () => {
  it('returns metadata for a file', async () => {
    const filePath = path.join(tempDir, 'meta-test.txt');
    await fs.writeFile(filePath, 'hello world');
    const metadata = await getFileMetadata(filePath);
    expect(metadata.name).toBe('meta-test.txt');
    expect(metadata.type).toBe('file');
    expect(metadata.size).toBe(11);
    expect(metadata.modified).toBeDefined();
  });
});
