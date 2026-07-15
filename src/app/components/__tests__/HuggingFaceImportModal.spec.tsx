import { render, screen, waitFor } from '@testing-library/react';
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
  });

  it('should render the modal with form fields', () => {
    render(<HuggingFaceImportModal {...defaultProps} />);
    expect(screen.getByText('Import from HuggingFace')).toBeInTheDocument();
    expect(screen.getByLabelText('Model ID *')).toBeInTheDocument();
    expect(screen.getByLabelText('HuggingFace Token')).toBeInTheDocument();
    expect(screen.getByLabelText('Destination Prefix')).toBeInTheDocument();
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
    const mockES = { onmessage: null as unknown, onerror: null as unknown, close: jest.fn() };
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

    const mockES = { onmessage: null as unknown, onerror: null as unknown, close: jest.fn() };
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

    const mockES = { onmessage: null as unknown, onerror: null as unknown, close: jest.fn() };
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

  it('should pass hfToken and prefix when provided', async () => {
    mockStorageService.importHuggingFace.mockResolvedValue({
      jobId: 'job-4',
      sseUrl: '/api/transfer/progress/job-4',
      fileCount: 1,
      modelId: 'owner/model',
    });

    const mockES = { onmessage: null as unknown, onerror: null as unknown, close: jest.fn() };
    const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
    (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;

    render(<HuggingFaceImportModal {...defaultProps} />);
    await userEvent.type(screen.getByLabelText('Model ID *'), 'owner/model');
    await userEvent.type(screen.getByLabelText('HuggingFace Token'), 'hf_test_token');
    await userEvent.type(screen.getByLabelText('Destination Prefix'), 'my-prefix');
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(mockStorageService.importHuggingFace).toHaveBeenCalledWith(
        'test-ns',
        expect.objectContaining({
          hfToken: 'hf_test_token',
          prefix: 'my-prefix',
        }),
      );
    });

    delete (globalThis as Record<string, unknown>).EventSource;
  });
});
