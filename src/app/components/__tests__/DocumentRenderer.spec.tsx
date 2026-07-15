import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentRenderer, { getFileType, isPreviewable } from '../StorageBrowser/DocumentRenderer';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation, FileInfo } from '~/app/types/storage';

jest.mock('~/app/services/storageService');
jest.mock('~/app/services/apiClient', () => ({
  apiClient: {
    getDownloadUrl: (ns: string, path: string) => `/brewet/api/${ns}${path}`,
  },
}));
jest.mock('~/app/utils/encoding', () => ({
  base64Encode: (s: string) => Buffer.from(s).toString('base64'),
}));

const mockStorageService = storageService as jest.Mocked<typeof storageService>;

const s3Location: StorageLocation = { id: 'my-bucket', name: 'my-bucket', type: 's3', status: 'available' };

const defaultProps = {
  namespace: 'test-ns',
  location: s3Location,
  currentPath: '',
  onClose: jest.fn(),
  onDownload: jest.fn(),
};

describe('getFileType', () => {
  it.each([
    ['data.json', 'json'],
    ['data.jsonl', 'json'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yaml'],
    ['README.md', 'markdown'],
    ['notes.mdx', 'markdown'],
    ['photo.png', 'image'],
    ['photo.jpg', 'image'],
    ['photo.jpeg', 'image'],
    ['photo.gif', 'image'],
    ['photo.svg', 'image'],
    ['app.ts', 'code'],
    ['app.py', 'code'],
    ['readme.txt', 'text'],
    ['run.sh', 'text'],
    ['.env', 'text'],
    ['model.bin', 'unsupported'],
    ['archive.zip', 'unsupported'],
  ] as const)('should detect %s as %s', (name, expected) => {
    expect(getFileType(name)).toBe(expected);
  });

  it('should detect Makefile/Dockerfile as text', () => {
    expect(getFileType('Makefile')).toBe('text');
    expect(getFileType('Dockerfile')).toBe('text');
  });
});

describe('isPreviewable', () => {
  it('should return true for all types except unsupported', () => {
    expect(isPreviewable('json')).toBe(true);
    expect(isPreviewable('yaml')).toBe(true);
    expect(isPreviewable('markdown')).toBe(true);
    expect(isPreviewable('text')).toBe(true);
    expect(isPreviewable('code')).toBe(true);
    expect(isPreviewable('image')).toBe(true);
    expect(isPreviewable('unsupported')).toBe(false);
  });
});

describe('DocumentRenderer', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should show loading spinner while fetching', async () => {
    mockStorageService.viewFile.mockReturnValue(new Promise(() => {}));
    const file: FileInfo = { name: 'data.json', isDirectory: false, size: 100 };
    render(<DocumentRenderer {...defaultProps} file={file} />);
    expect(screen.getByLabelText('Loading file content')).toBeInTheDocument();
  });

  it('should render JSON content in a code block', async () => {
    const jsonContent = '{"key":"value","num":42}';
    mockStorageService.viewFile.mockResolvedValue(jsonContent);
    const file: FileInfo = { name: 'data.json', isDirectory: false, size: 100 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText(/"key"/)).toBeInTheDocument();
    });
  });

  it('should render plain text content', async () => {
    mockStorageService.viewFile.mockResolvedValue('hello world');
    const file: FileInfo = { name: 'notes.txt', isDirectory: false, size: 11 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeInTheDocument();
    });
  });

  it('should show error alert when viewFile fails', async () => {
    mockStorageService.viewFile.mockRejectedValue(new Error('Not found'));
    const file: FileInfo = { name: 'missing.txt', isDirectory: false, size: 0 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText('Not found')).toBeInTheDocument();
    });
  });

  it('should render image files with img tag', async () => {
    const file: FileInfo = { name: 'photo.png', isDirectory: false, size: 5000 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      const img = screen.getByTestId('preview-image');
      expect(img).toBeInTheDocument();
      expect(img).toHaveAttribute('alt', 'photo.png');
    });
  });

  it('should show download fallback for unsupported types', async () => {
    const file: FileInfo = { name: 'model.bin', isDirectory: false, size: 1000000 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText(/This file type cannot be previewed/)).toBeInTheDocument();
      expect(screen.getByText('Download to view')).toBeInTheDocument();
    });
  });

  it('should call onDownload when download button is clicked', async () => {
    mockStorageService.viewFile.mockResolvedValue('content');
    const file: FileInfo = { name: 'readme.txt', isDirectory: false, size: 7 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText('content')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Download'));
    expect(defaultProps.onDownload).toHaveBeenCalledWith(file);
  });

  it('should call onClose when close button is clicked', async () => {
    mockStorageService.viewFile.mockResolvedValue('content');
    const file: FileInfo = { name: 'readme.txt', isDirectory: false, size: 7 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText('content')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Close'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should show modal title as file name', async () => {
    mockStorageService.viewFile.mockResolvedValue('content');
    const file: FileInfo = { name: 'config.yaml', isDirectory: false, size: 50 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByText('config.yaml')).toBeInTheDocument();
    });
  });

  it('should not call viewFile for image files', async () => {
    const file: FileInfo = { name: 'logo.svg', isDirectory: false, size: 500 };
    render(<DocumentRenderer {...defaultProps} file={file} />);

    await waitFor(() => {
      expect(screen.getByTestId('preview-image')).toBeInTheDocument();
    });

    expect(mockStorageService.viewFile).not.toHaveBeenCalled();
  });
});
