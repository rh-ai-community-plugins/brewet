import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StorageBrowser from '../StorageBrowser/StorageBrowser';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation, FileListResponse } from '~/app/types/storage';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/services/storageService');

const mockNavigate = jest.fn();
const mockParams: Record<string, string | undefined> = {};

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockStorageService = storageService as jest.Mocked<typeof storageService>;

const mockLocations: StorageLocation[] = [
  { id: 'my-bucket', name: 'my-bucket', type: 's3', status: 'available' },
  { id: 'local-0', name: 'pvc-data', type: 'pvc', status: 'available' },
  { id: 'local-1', name: 'pvc-models', type: 'pvc', status: 'unavailable', error: 'Not mounted' },
];

const mockFileResponse: FileListResponse = {
  files: [
    { name: 'subfolder', isDirectory: true },
    { name: 'readme.txt', isDirectory: false, size: 1024, lastModified: '2024-06-01T12:00:00Z' },
    { name: 'data.csv', isDirectory: false, size: 5242880, lastModified: '2024-06-02T12:00:00Z' },
  ],
  isTruncated: false,
};

function setupMocks(params?: Record<string, string | undefined>) {
  Object.keys(mockParams).forEach((k) => delete mockParams[k]);
  if (params) Object.assign(mockParams, params);

  mockUseBrewetContext.mockReturnValue({
    selectedProject: 'test-ns',
    setSelectedProject: jest.fn(),
    containerStatus: 'running',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    isActioning: false,
    setIsActioning: jest.fn(),
  });
  mockStorageService.getLocations.mockResolvedValue(mockLocations);
  mockStorageService.refreshLocations.mockResolvedValue(mockLocations);
  mockStorageService.listFiles.mockResolvedValue(mockFileResponse);
  mockStorageService.getMaxFilesPerPage.mockResolvedValue(100);
  mockStorageService.downloadFile.mockResolvedValue('/brewet/api/test-ns/objects/download/my-bucket/cmVhZG1lLnR4dA');
  mockStorageService.deleteFile.mockResolvedValue(undefined);
  mockStorageService.createFolder.mockResolvedValue(undefined);
  mockStorageService.uploadFile.mockResolvedValue({} as Response);
}

describe('StorageBrowser', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockNavigate.mockClear();
  });

  describe('Location selector', () => {
    it('should show "Select location..." when no location selected', async () => {
      setupMocks();
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('Select location...')).toBeInTheDocument();
      });
    });

    it('should show the selected location name in toggle and breadcrumb', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        const matches = screen.getAllByText('my-bucket');
        expect(matches.length).toBeGreaterThanOrEqual(2);
      });
    });

    it('should show prompt text when no location is selected', async () => {
      setupMocks();
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('Select a storage location to browse files.')).toBeInTheDocument();
      });
    });
  });

  describe('File listing', () => {
    it('should show files when a location is selected', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });
      expect(screen.getByText('data.csv')).toBeInTheDocument();
      expect(screen.getByText('subfolder')).toBeInTheDocument();
    });

    it('should show file sizes', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });
      expect(screen.getByText('1 KB')).toBeInTheDocument();
      expect(screen.getByText('5 MB')).toBeInTheDocument();
    });

    it('should show empty folder message when no files', async () => {
      setupMocks({ locationId: 'my-bucket' });
      mockStorageService.listFiles.mockResolvedValue({ files: [] });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('This folder is empty.')).toBeInTheDocument();
      });
    });

    it('should show loading spinner while fetching files', async () => {
      setupMocks({ locationId: 'my-bucket' });
      let resolveLocations: (v: StorageLocation[]) => void;
      mockStorageService.getLocations.mockReturnValue(
        new Promise((resolve) => { resolveLocations = resolve; }),
      );
      mockStorageService.listFiles.mockReturnValue(new Promise(() => {}));

      render(<StorageBrowser />);

      // Locations loading first
      expect(screen.getByLabelText('Loading storage locations')).toBeInTheDocument();

      // Resolve locations, triggering file load
      resolveLocations!(mockLocations);

      await waitFor(() => {
        expect(screen.getByLabelText('Loading files')).toBeInTheDocument();
      });
    });

    it('should show error when file loading fails', async () => {
      setupMocks({ locationId: 'my-bucket' });
      mockStorageService.listFiles.mockRejectedValue(new Error('Connection lost'));
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('Connection lost')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should navigate into folder on click', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('subfolder')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('subfolder'));
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/brewet/storage/browse/my-bucket/'),
      );
    });
  });

  describe('Delete', () => {
    it('should show delete confirmation modal', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Delete readme.txt'));
      expect(screen.getByText('Delete File')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
    });

    it('should show recursive deletion warning for folders', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('subfolder')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Delete subfolder'));
      expect(screen.getByText('Delete Folder')).toBeInTheDocument();
      expect(screen.getByText('Recursive deletion')).toBeInTheDocument();
    });

    it('should call deleteFile on confirm', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Delete readme.txt'));
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

      await waitFor(() => {
        expect(mockStorageService.deleteFile).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ id: 'my-bucket' }),
          'readme.txt',
        );
      });
    });
  });

  describe('Create folder', () => {
    it('should open create folder modal', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Create Folder'));
      expect(screen.getByLabelText('Folder name *')).toBeInTheDocument();
    });

    it('should validate folder name', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Create Folder'));
      const input = screen.getByLabelText('Folder name *');
      await userEvent.type(input, 'my/folder');
      await userEvent.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(screen.getByText('Folder name cannot contain slashes.')).toBeInTheDocument();
      });
    });

    it('should call createFolder on valid submit', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByText('Create Folder'));
      const input = screen.getByLabelText('Folder name *');
      await userEvent.type(input, 'new-folder');
      await userEvent.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => {
        expect(mockStorageService.createFolder).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ id: 'my-bucket' }),
          'new-folder/',
        );
      });
    });
  });

  describe('Download', () => {
    it('should show download button for files', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('Download readme.txt')).toBeInTheDocument();
    });

    it('should not show download button for folders', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('subfolder')).toBeInTheDocument();
      });

      expect(screen.queryByLabelText('Download subfolder')).not.toBeInTheDocument();
    });

    it('should show error alert when downloadFile rejects', async () => {
      setupMocks({ locationId: 'my-bucket' });
      mockStorageService.downloadFile.mockRejectedValue(new Error('Network error'));
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Download readme.txt'));

      await waitFor(() => {
        expect(screen.getByText('Download failed')).toBeInTheDocument();
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('Upload', () => {
    it('should show upload button', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      expect(screen.getByText('Upload')).toBeInTheDocument();
    });
  });

  describe('Load more', () => {
    it('should show load more button when results are truncated', async () => {
      setupMocks({ locationId: 'my-bucket' });
      mockStorageService.listFiles.mockResolvedValue({
        files: mockFileResponse.files,
        isTruncated: true,
        continuationToken: 'next-token',
      });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('Load More')).toBeInTheDocument();
      });
    });

    it('should not show load more button when all results loaded', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });
      expect(screen.queryByText('Load More')).not.toBeInTheDocument();
    });
  });

  describe('No locations', () => {
    it('should show info alert when no locations available', async () => {
      setupMocks();
      mockStorageService.getLocations.mockResolvedValue([]);
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('No storage locations found')).toBeInTheDocument();
      });
    });
  });

  describe('Search', () => {
    it('should show search input and mode toggle', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
      });
      expect(screen.getByText('Prefix')).toBeInTheDocument();
      expect(screen.getByText('Contains')).toBeInTheDocument();
    });

    it('should filter S3 files client-side when fewer than 3 characters are typed in startsWith mode', async () => {
      // Regression test for issue #100: 1-2 character S3 prefix searches were showing all
      // files instead of filtering because the client-side bypass was unconditional.
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);

      // Wait for initial file listing to load (all three items present)
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });
      expect(screen.getByText('data.csv')).toBeInTheDocument();
      expect(screen.getByText('subfolder')).toBeInTheDocument();

      // Type 2 characters — startsWith (Prefix) is the default search mode.
      // Server-side filtering only activates at >=3 characters, so the client-side
      // prefix filter must handle this range.
      const searchInput = screen.getByPlaceholderText('Search files...');
      await userEvent.type(searchInput, 're');

      // Only 'readme.txt' starts with 're'; the other entries must be filtered out.
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
        expect(screen.queryByText('data.csv')).not.toBeInTheDocument();
        expect(screen.queryByText('subfolder')).not.toBeInTheDocument();
      });
    });
  });

  describe('Refresh', () => {
    it('should call refreshLocations on refresh click', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      await userEvent.click(screen.getByLabelText('Refresh'));
      await waitFor(() => {
        expect(mockStorageService.refreshLocations).toHaveBeenCalledWith('test-ns');
      });
    });

    it('should show danger Alert when refreshLocations rejects', async () => {
      setupMocks({ locationId: 'my-bucket' });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      mockStorageService.refreshLocations.mockRejectedValue(new Error('Refresh failed'));
      await userEvent.click(screen.getByLabelText('Refresh'));
      await waitFor(() => {
        expect(screen.getByText('Refresh failed')).toBeInTheDocument();
      });
    });
  });
  describe('Contains search warning', () => {
    it('should show warning alert in contains mode for S3 when more pages are available', async () => {
      setupMocks({ locationId: 'my-bucket' });
      mockStorageService.listFiles.mockResolvedValue({
        files: mockFileResponse.files,
        isTruncated: true,
        continuationToken: 'next-token',
      });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      // Switch to contains mode and enter a search term
      await userEvent.click(screen.getByText('Contains'));
      const searchInput = screen.getByPlaceholderText('Search files...');
      await userEvent.type(searchInput, 're');

      await waitFor(() => {
        expect(screen.getByText('Search covers loaded files only')).toBeInTheDocument();
      });
    });

    it('should not show warning alert when in startsWith (Prefix) mode', async () => {
      setupMocks({ locationId: 'my-bucket' });
      mockStorageService.listFiles.mockResolvedValue({
        files: mockFileResponse.files,
        isTruncated: true,
        continuationToken: 'next-token',
      });
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      // startsWith (Prefix) is the default mode — just type a search term
      const searchInput = screen.getByPlaceholderText('Search files...');
      await userEvent.type(searchInput, 're');

      expect(screen.queryByText('Search covers loaded files only')).not.toBeInTheDocument();
    });

    it('should not show warning alert in contains mode when all pages are loaded', async () => {
      setupMocks({ locationId: 'my-bucket' });
      // Default mockFileResponse has isTruncated: false and no continuationToken
      render(<StorageBrowser />);
      await waitFor(() => {
        expect(screen.getByText('readme.txt')).toBeInTheDocument();
      });

      // Switch to contains mode and enter a search term
      await userEvent.click(screen.getByText('Contains'));
      const searchInput = screen.getByPlaceholderText('Search files...');
      await userEvent.type(searchInput, 're');

      expect(screen.queryByText('Search covers loaded files only')).not.toBeInTheDocument();
    });
  });

  describe('PVC pagination', () => {
    it('should pass fetched pageLimit to listFiles for PVC locations', async () => {
      setupMocks({ locationId: 'local-0' });
      mockStorageService.getMaxFilesPerPage.mockResolvedValue(50);
      render(<StorageBrowser />);

      await waitFor(() => {
        expect(mockStorageService.listFiles).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ id: 'local-0', type: 'pvc' }),
          '',
          expect.objectContaining({ limit: 50 }),
          expect.any(AbortSignal),
        );
      });
    });

    it('should fall back to default pageLimit when getMaxFilesPerPage fails for PVC', async () => {
      setupMocks({ locationId: 'local-0' });
      mockStorageService.getMaxFilesPerPage.mockRejectedValue(new Error('Service unavailable'));
      render(<StorageBrowser />);

      await waitFor(() => {
        expect(mockStorageService.listFiles).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ id: 'local-0', type: 'pvc' }),
          '',
          expect.objectContaining({ limit: 100 }),
          expect.any(AbortSignal),
        );
      });
    });
  });

});
