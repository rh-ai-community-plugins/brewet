import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferModal from '../StorageBrowser/TransferModal';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation, FileInfo } from '~/app/types/storage';

jest.mock('~/app/services/storageService');
jest.mock('~/app/services/apiClient', () => ({
  apiClient: {
    getDownloadUrl: (ns: string, path: string) => `/brewet/api/${ns}${path}`,
  },
}));

const mockService = storageService as jest.Mocked<typeof storageService>;

const s3Location: StorageLocation = { id: 'source-bucket', name: 'source-bucket', type: 's3', status: 'available' };
const destBucket: StorageLocation = { id: 'dest-bucket', name: 'dest-bucket', type: 's3', status: 'available' };
const destPvc: StorageLocation = { id: 'local-0', name: 'pvc-data', type: 'pvc', status: 'available' };
const unavailableLoc: StorageLocation = { id: 'broken', name: 'broken', type: 'pvc', status: 'unavailable' };

const selectedFiles: FileInfo[] = [
  { name: 'file1.txt', isDirectory: false, size: 1024 },
  { name: 'models/', isDirectory: true, size: 0 },
];

const locations: StorageLocation[] = [s3Location, destBucket, destPvc, unavailableLoc];

const defaultProps = {
  namespace: 'test-ns',
  sourceLocation: s3Location,
  currentPath: '',
  selectedFiles,
  locations,
  onClose: jest.fn(),
  onComplete: jest.fn(),
};

function setupEventSourceMock() {
  const mockES = {
    addEventListener: jest.fn(),
    onerror: null as ((ev: Event) => void) | null,
    close: jest.fn(),
  };
  const EventSourceSpy = jest.fn().mockImplementation(() => mockES);
  (globalThis as Record<string, unknown>).EventSource = EventSourceSpy;
  return mockES;
}

function cleanupEventSourceMock() {
  delete (globalThis as Record<string, unknown>).EventSource;
}

describe('TransferModal', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterEach(() => {
    cleanupEventSourceMock();
  });

  describe('Destination step', () => {
    it('should render the modal with source info and destination selector', () => {
      render(<TransferModal {...defaultProps} />);
      expect(screen.getByText('Transfer Files')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('source-bucket')).toBeInTheDocument();
      expect(screen.getByText('Select destination...')).toBeInTheDocument();
    });

    it('should show source path when currentPath is set', () => {
      render(<TransferModal {...defaultProps} currentPath="data/models/" />);
      expect(screen.getByText(/data\/models/)).toBeInTheDocument();
    });

    it('should disable Next button when no destination selected', () => {
      render(<TransferModal {...defaultProps} />);
      expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    });

    it('should call onClose when Cancel is clicked', async () => {
      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  describe('Conflict detection', () => {
    it('should skip conflicts step when no conflicts found and start transfer', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: ['file1.txt', 'models/'],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'job-1',
        sseUrl: '/api/transfer/progress/job-1',
        fileCount: 2,
        totalSize: 1024,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/job-1');
      const mockES = setupEventSourceMock();

      render(<TransferModal {...defaultProps} />);

      // Open the select and pick dest-bucket
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));

      // Click Next
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockService.checkConflicts).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({
            source: 's3:source-bucket',
            destination: 's3:dest-bucket',
            items: [
              { path: 'file1.txt', type: 'file' },
              { path: 'models/', type: 'directory' },
            ],
          }),
          expect.any(AbortSignal),
        );
      });

      // Should skip to progress (transfer started)
      await waitFor(() => {
        expect(mockService.initiateTransfer).toHaveBeenCalled();
      });

      // Simulate SSE progress listener registration
      expect(mockES.addEventListener).toHaveBeenCalledWith('progress', expect.any(Function));
    });

    it('should show conflicts step when conflicts are found', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [
          { path: 'file1.txt', sourceSize: 1024, destinationSize: 512 },
        ],
        nonConflicting: ['models/'],
      });

      render(<TransferModal {...defaultProps} />);

      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Resolve Conflicts')).toBeInTheDocument();
      });
      expect(screen.getByText(/1 file already exist/)).toBeInTheDocument();
      expect(screen.getByText('file1.txt')).toBeInTheDocument();
      expect(screen.getByLabelText('Overwrite existing files')).toBeChecked();
      expect(screen.getByLabelText('Skip conflicting files')).not.toBeChecked();
      expect(screen.getByLabelText(/Rename with suffix/)).not.toBeChecked();
    });

    it('should show warning from conflict check', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [{ path: 'big.bin', sourceSize: 999, destinationSize: 111 }],
        nonConflicting: [],
        warning: 'Transfer exceeds 10 GB',
      });

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Transfer exceeds 10 GB')).toBeInTheDocument();
      });
    });

    it('should show error when conflict check fails', async () => {
      mockService.checkConflicts.mockRejectedValue(new Error('Service down'));

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Service down')).toBeInTheDocument();
      });
    });
  });

  describe('Transfer progress', () => {
    it('should show progress from SSE events', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: ['file1.txt'],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'job-2',
        sseUrl: '/api/transfer/progress/job-2',
        fileCount: 2,
        totalSize: 2048,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/job-2');
      const mockES = setupEventSourceMock();

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockES.addEventListener).toHaveBeenCalledWith('progress', expect.any(Function));
      });

      // Simulate SSE progress event
      const progressHandler = mockES.addEventListener.mock.calls.find(
        ([name]: [string]) => name === 'progress',
      )![1] as (event: { data: string }) => void;

      act(() => {
        progressHandler({
          data: JSON.stringify({
            jobId: 'job-2',
            status: 'active',
            type: 'cross-storage',
            totalFiles: 2,
            completedFiles: 1,
            failedFiles: 0,
            cancelledFiles: 0,
            totalBytes: 2048,
            loadedBytes: 1024,
            currentFile: 'file1.txt',
            files: [],
          }),
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/1 \/ 2 files/)).toBeInTheDocument();
        expect(screen.getByText(/file1\.txt/)).toBeInTheDocument();
      });
    });

    it('should show completion alert and call onComplete', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: ['file1.txt'],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'job-3',
        sseUrl: '/api/transfer/progress/job-3',
        fileCount: 1,
        totalSize: 100,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/job-3');
      const mockES = setupEventSourceMock();

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockES.addEventListener).toHaveBeenCalled();
      });

      const progressHandler = mockES.addEventListener.mock.calls.find(
        ([name]: [string]) => name === 'progress',
      )![1] as (event: { data: string }) => void;

      act(() => {
        progressHandler({
          data: JSON.stringify({
            jobId: 'job-3',
            status: 'completed',
            type: 'cross-storage',
            totalFiles: 1,
            completedFiles: 1,
            failedFiles: 0,
            cancelledFiles: 0,
            totalBytes: 100,
            loadedBytes: 100,
            files: [],
          }),
        });
      });

      await waitFor(() => {
        expect(screen.getByText('Transfer completed')).toBeInTheDocument();
      });
      expect(mockES.close).toHaveBeenCalled();
      expect(defaultProps.onComplete).toHaveBeenCalled();
    });

    it('should handle transfer start failure', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: [],
      });
      mockService.initiateTransfer.mockRejectedValue(new Error('Backend unreachable'));
      setupEventSourceMock();

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByText('Backend unreachable')).toBeInTheDocument();
      });
      expect(screen.queryByRole('button', { name: 'Cancel Transfer' })).not.toBeInTheDocument();
    });

    it('should call cancelTransfer when Cancel Transfer is clicked', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: [],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'job-cancel',
        sseUrl: '/api/transfer/progress/job-cancel',
        fileCount: 5,
        totalSize: 5000,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/job-cancel');
      mockService.cancelTransfer.mockResolvedValue({ cancelled: true, jobId: 'job-cancel' });
      const mockES = setupEventSourceMock();

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockES.addEventListener).toHaveBeenCalled();
      });

      // Simulate active progress so Cancel button is visible
      const progressHandler = mockES.addEventListener.mock.calls.find(
        ([name]: [string]) => name === 'progress',
      )![1] as (event: { data: string }) => void;
      act(() => {
        progressHandler({
          data: JSON.stringify({
            jobId: 'job-cancel',
            status: 'active',
            type: 'cross-storage',
            totalFiles: 5,
            completedFiles: 1,
            failedFiles: 0,
            cancelledFiles: 0,
            totalBytes: 5000,
            loadedBytes: 1000,
            files: [],
          }),
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel Transfer' })).toBeInTheDocument();
      });

      await userEvent.click(screen.getByRole('button', { name: 'Cancel Transfer' }));

      await waitFor(() => {
        expect(mockService.cancelTransfer).toHaveBeenCalledWith('test-ns', 'job-cancel');
      });
    });

    it('should keep Cancel Transfer button visible when SSE connection drops', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: [],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'job-sse-drop',
        sseUrl: '/api/transfer/progress/job-sse-drop',
        fileCount: 3,
        totalSize: 3000,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/job-sse-drop');
      // Prevent the polling interval from calling the real service
      mockService.getTransferProgress.mockReturnValue(new Promise(() => {}));
      const mockES = setupEventSourceMock();

      render(<TransferModal {...defaultProps} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockES.addEventListener).toHaveBeenCalledWith('progress', expect.any(Function));
      });

      // Simulate active progress to confirm transfer is running
      const progressHandler = mockES.addEventListener.mock.calls.find(
        ([name]: [string]) => name === 'progress',
      )![1] as (event: { data: string }) => void;
      act(() => {
        progressHandler({
          data: JSON.stringify({
            jobId: 'job-sse-drop',
            status: 'active',
            type: 'cross-storage',
            totalFiles: 3,
            completedFiles: 1,
            failedFiles: 0,
            cancelledFiles: 0,
            totalBytes: 3000,
            loadedBytes: 1000,
            files: [],
          }),
        });
      });

      // Trigger SSE connection drop
      act(() => {
        if (mockES.onerror) mockES.onerror(new Event('error'));
      });

      await waitFor(() => {
        expect(
          screen.getByText('Progress connection lost. The transfer continues in the background.'),
        ).toBeInTheDocument();
      });

      // Cancel Transfer button must remain visible even after SSE error
      expect(screen.getByRole('button', { name: 'Cancel Transfer' })).toBeInTheDocument();
    });
  });

  describe('Source path construction', () => {
    it('should build source path with currentPath', async () => {
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: [],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'j',
        sseUrl: '/api/transfer/progress/j',
        fileCount: 1,
        totalSize: 10,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/j');
      setupEventSourceMock();

      render(<TransferModal {...defaultProps} currentPath="data/models/" />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockService.checkConflicts).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({
            source: 's3:source-bucket/data/models',
          }),
          expect.any(AbortSignal),
        );
      });
    });

    it('should build PVC source path correctly', async () => {
      const pvcSource: StorageLocation = { id: 'local-0', name: 'pvc-data', type: 'pvc', status: 'available' };
      mockService.checkConflicts.mockResolvedValue({
        conflicts: [],
        nonConflicting: [],
      });
      mockService.initiateTransfer.mockResolvedValue({
        jobId: 'j',
        sseUrl: '/api/transfer/progress/j',
        fileCount: 1,
        totalSize: 10,
      });
      mockService.getTransferSseUrl.mockReturnValue('/brewet/api/test-ns/transfer/progress/j');
      setupEventSourceMock();

      render(<TransferModal {...defaultProps} sourceLocation={pvcSource} />);
      await userEvent.click(screen.getByText('Select destination...'));
      await userEvent.click(screen.getByText('dest-bucket'));
      await userEvent.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(mockService.checkConflicts).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({
            source: 'local:local-0',
          }),
          expect.any(AbortSignal),
        );
      });
    });
  });
});
