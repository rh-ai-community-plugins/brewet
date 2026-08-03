import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HuggingFaceImportModal from '../StorageBrowser/HuggingFaceImportModal';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation } from '~/app/types/storage';

jest.mock('~/app/services/storageService');
jest.mock('~/app/services/apiClient', () => ({
  apiClient: {
    getDownloadUrl: (ns: string, path: string) => `/brewet/api/${ns}${path}`,
  },
}));

const mockStorageService = storageService as jest.Mocked<typeof storageService>;

const s3Location: StorageLocation = { id: 'my-bucket', name: 'my-bucket', type: 's3', status: 'available' };
const pvcLocation: StorageLocation = { id: 'local-0', name: 'pvc-data', type: 'pvc', status: 'available' };

const defaultProps = {
  namespace: 'test-ns',
  location: s3Location,
  currentPath: '',
  onClose: jest.fn(),
  onComplete: jest.fn(),
};

describe('HuggingFaceImportModal', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockStorageService.getHuggingFaceSettings.mockResolvedValue({ hfToken: '' });
  });

  it('should render the modal with form fields', () => {
    render(<HuggingFaceImportModal {...defaultProps} />);
    expect(screen.getByText('Import from HuggingFace')).toBeInTheDocument();
    expect(screen.getByLabelText('Model ID *')).toBeInTheDocument();
    expect(screen.getByLabelText('HuggingFace Token')).toBeInTheDocument();
  });

  it('should show validation error when model ID is empty', async () => {
    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    // Button is disabled when modelId is empty, so import shouldn't call the service
    expect(mockStorageService.importHuggingFace).not.toHaveBeenCalled();
  });

  it('should show validation error for invalid model ID format', async () => {
    render(<HuggingFaceImportModal {...defaultProps} />);
    const input = screen.getByLabelText('Model ID *');
    await userEvent.type(input, 'invalid-format');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(screen.getByText(/must be in owner\/model format/)).toBeInTheDocument();
    });
    expect(mockStorageService.importHuggingFace).not.toHaveBeenCalled();
  });

  it('should call importHuggingFace with correct params for S3 location', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-1',
      sseUrl: '/api/transfer/progress/job-1',
      fileCount: 5,
      modelId: 'owner/model',
    });

    // Mock EventSource
    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    const input = screen.getByLabelText('Model ID *');
    await userEvent.type(input, 'meta-llama/Llama-2-7b');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(mockStorageService.importHuggingFace).toHaveBeenCalledWith(
        'test-ns',
        expect.objectContaining({
          modelId: 'meta-llama/Llama-2-7b',
          destinationType: 's3',
          bucketName: 'my-bucket',
          prefix: 'meta-llama/Llama-2-7b',
        }),
      );
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should prepend currentPath to prefix for S3 location', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-1b',
      sseUrl: '/api/transfer/progress/job-1b',
      fileCount: 5,
      modelId: 'owner/model',
    });

    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} currentPath="some/folder/" />);
    const input = screen.getByLabelText('Model ID *');
    await userEvent.type(input, 'meta-llama/Llama-2-7b');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(mockStorageService.importHuggingFace).toHaveBeenCalledWith(
        'test-ns',
        expect.objectContaining({
          prefix: 'some/folder/meta-llama/Llama-2-7b',
        }),
      );
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should call importHuggingFace with correct params for PVC location', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-2',
      sseUrl: '/api/transfer/progress/job-2',
      fileCount: 3,
      modelId: 'owner/model',
    });

    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} location={pvcLocation} />);
    const input = screen.getByLabelText('Model ID *');
    await userEvent.type(input, 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(mockStorageService.importHuggingFace).toHaveBeenCalledWith(
        'test-ns',
        expect.objectContaining({
          modelId: 'owner/model',
          destinationType: 'local',
          localLocationId: 'local-0',
          prefix: 'owner/model',
        }),
      );
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should show error when import fails', async () => {
    mockStorageService.importHuggingFace.mockRejectedValue(new Error('Model not found'));

    render(<HuggingFaceImportModal {...defaultProps} />);
    const input = screen.getByLabelText('Model ID *');
    await userEvent.type(input, 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(screen.getByText('Model not found')).toBeInTheDocument();
    });
  });

  it('should show progress after successful submit', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-3',
      sseUrl: '/api/transfer/progress/job-3',
      fileCount: 10,
      modelId: 'meta-llama/Llama-2-7b',
    });

    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    const input = screen.getByLabelText('Model ID *');
    await userEvent.type(input, 'meta-llama/Llama-2-7b');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(screen.getByText(/Importing/)).toBeInTheDocument();
      expect(screen.getAllByText(/10 files/).length).toBeGreaterThanOrEqual(1);
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should call onClose when Cancel is clicked', async () => {
    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('should pass hfToken when provided', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-4',
      sseUrl: '/api/transfer/progress/job-4',
      fileCount: 1,
      modelId: 'owner/model',
    });

    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.type(screen.getByLabelText('HuggingFace Token'), 'hf_test_token');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(mockStorageService.importHuggingFace).toHaveBeenCalledWith(
        'test-ns',
        expect.objectContaining({
          hfToken: 'hf_test_token',
          prefix: 'owner/model',
        }),
      );
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should prefill token from saved settings', async () => {
    mockStorageService.getHuggingFaceSettings.mockResolvedValue({ hfToken: 'hf_saved_token_123' });

    render(<HuggingFaceImportModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('HuggingFace Token')).toHaveValue('hf_saved_token_123');
    });
  });

  it('should toggle token visibility with show/hide button', async () => {
    mockStorageService.getHuggingFaceSettings.mockResolvedValue({ hfToken: 'hf_saved_token_123' });

    render(<HuggingFaceImportModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText('HuggingFace Token')).toHaveValue('hf_saved_token_123');
    });

    const tokenInput = screen.getByLabelText('HuggingFace Token');
    expect(tokenInput).toHaveAttribute('type', 'password');

    await userEvent.click(screen.getByLabelText('Show token'));
    expect(tokenInput).toHaveAttribute('type', 'text');

    await userEvent.click(screen.getByLabelText('Hide token'));
    expect(tokenInput).toHaveAttribute('type', 'password');
  });

  it('should show Cancel Import button during active import', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-cancel-1',
      sseUrl: '/api/transfer/progress/job-cancel-1',
      fileCount: 5,
      modelId: 'owner/model',
    });

    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel Import' })).toBeInTheDocument();
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should call cancelTransfer when Cancel Import is clicked', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-cancel-2',
      sseUrl: '/api/transfer/progress/job-cancel-2',
      fileCount: 5,
      modelId: 'owner/model',
    });
    mockStorageService.cancelTransfer.mockResolvedValue({ cancelled: true, jobId: 'job-cancel-2' });

    const mockES = { addEventListener: jest.fn(), onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel Import' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel Import' }));

    await waitFor(() => {
      expect(mockStorageService.cancelTransfer).toHaveBeenCalledWith('test-ns', 'job-cancel-2');
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should show cancelled alert when SSE reports cancelled status', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-cancel-3',
      sseUrl: '/api/transfer/progress/job-cancel-3',
      fileCount: 10,
      modelId: 'owner/model',
    });

    let progressHandler: ((event: { data: string }) => void) | null = null;
    const mockES = {
      addEventListener: jest.fn((_event: string, handler: (event: { data: string }) => void) => {
        progressHandler = handler;
      }),
      onerror: null as unknown,
      close: jest.fn(),
    };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(progressHandler).not.toBeNull();
    });

    // Simulate SSE cancelled event
    act(() => {
      progressHandler!({
        data: JSON.stringify({
          jobId: 'job-cancel-3',
          status: 'cancelled',
          type: 'huggingface',
          totalFiles: 10,
          completedFiles: 3,
          failedFiles: 0,
          cancelledFiles: 7,
          totalBytes: 1000,
          loadedBytes: 300,
          files: [],
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Import cancelled')).toBeInTheDocument();
      expect(screen.getByText(/3 of 10 files have already been downloaded/)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Keep Files' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Files' })).toBeInTheDocument();

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should keep files and close when Keep Files is clicked after cancel', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-cancel-4',
      sseUrl: '/api/transfer/progress/job-cancel-4',
      fileCount: 10,
      modelId: 'owner/model',
    });

    let progressHandler: ((event: { data: string }) => void) | null = null;
    const mockES = {
      addEventListener: jest.fn((_event: string, handler: (event: { data: string }) => void) => {
        progressHandler = handler;
      }),
      onerror: null as unknown,
      close: jest.fn(),
    };
    (globalThis as Record<string, unknown>).EventSource = jest.fn().mockImplementation(() => mockES);

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => { expect(progressHandler).not.toBeNull(); });

    act(() => {
      progressHandler!({
        data: JSON.stringify({
          jobId: 'job-cancel-4', status: 'cancelled', type: 'huggingface',
          totalFiles: 10, completedFiles: 5, failedFiles: 0, cancelledFiles: 5,
          totalBytes: 1000, loadedBytes: 500, files: [],
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Keep Files' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Keep Files' }));
    expect(defaultProps.onComplete).toHaveBeenCalled();

    delete (globalThis as Record<string, unknown>).EventSource;
  });

  it('should delete files and close when Delete Files is clicked after cancel', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-cancel-5',
      sseUrl: '/api/transfer/progress/job-cancel-5',
      fileCount: 10,
      modelId: 'owner/model',
    });
    mockStorageService.cleanupTransfer.mockResolvedValue({ cleaned: 3, errors: 0, jobId: 'job-cancel-5' });

    let progressHandler: ((event: { data: string }) => void) | null = null;
    const mockES = {
      addEventListener: jest.fn((_event: string, handler: (event: { data: string }) => void) => {
        progressHandler = handler;
      }),
      onerror: null as unknown,
      close: jest.fn(),
    };
    (globalThis as Record<string, unknown>).EventSource = jest.fn().mockImplementation(() => mockES);

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => { expect(progressHandler).not.toBeNull(); });

    act(() => {
      progressHandler!({
        data: JSON.stringify({
          jobId: 'job-cancel-5', status: 'cancelled', type: 'huggingface',
          totalFiles: 10, completedFiles: 3, failedFiles: 0, cancelledFiles: 7,
          totalBytes: 1000, loadedBytes: 300, files: [],
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete Files' })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Delete Files' }));

    await waitFor(() => {
      expect(mockStorageService.cleanupTransfer).toHaveBeenCalledWith('test-ns', 'job-cancel-5');
    });
    expect(defaultProps.onClose).toHaveBeenCalled();

    delete (globalThis as Record<string, unknown>).EventSource;
  });
});
