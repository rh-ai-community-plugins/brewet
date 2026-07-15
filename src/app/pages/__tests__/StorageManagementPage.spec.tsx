import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StorageManagementPage from '../StorageManagementPage';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation, BucketsList } from '~/app/types/storage';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useBrewetContainer');
jest.mock('~/app/services/storageService');
jest.mock('~/app/components/ContainerWizard', () => ({
  ContainerWizard: () => null,
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;
const mockStorageService = storageService as jest.Mocked<typeof storageService>;

const mockLocations: StorageLocation[] = [
  { id: 'bucket-1', name: 'bucket-1', type: 's3', status: 'available', creationDate: '2024-01-15T00:00:00Z' },
  { id: 'bucket-2', name: 'bucket-2', type: 's3', status: 'available', creationDate: '2024-03-01T00:00:00Z' },
  { id: 'local-0', name: 'pvc-data', type: 'pvc', status: 'available' },
  { id: 'local-1', name: 'pvc-models', type: 'pvc', status: 'unavailable', error: 'Mount not found' },
];

const mockBucketsList: BucketsList = {
  buckets: [
    { Name: 'bucket-1', CreationDate: '2024-01-15T00:00:00Z' },
    { Name: 'bucket-2', CreationDate: '2024-03-01T00:00:00Z' },
  ],
};

function setupMocks(overrides?: { containerStatus?: string }) {
  mockUseBrewetContext.mockReturnValue({
    selectedProject: 'test-ns',
    setSelectedProject: jest.fn(),
    containerStatus: (overrides?.containerStatus ?? 'running') as 'running',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    isActioning: false,
    setIsActioning: jest.fn(),
  });
  mockUseBrewetContainer.mockReturnValue({
    selectedProject: 'test-ns',
    containerStatus: (overrides?.containerStatus ?? 'running') as 'running',
    containerInfo: null,
    isActioning: false,
    startContainer: jest.fn(),
    stopContainer: jest.fn(),
    deleteContainer: jest.fn().mockResolvedValue(true),
    createContainer: jest.fn().mockResolvedValue([]),
    updateContainer: jest.fn().mockResolvedValue([]),
    refreshContainerStatus: jest.fn(),
  });
  mockStorageService.getLocations.mockResolvedValue(mockLocations);
  mockStorageService.refreshLocations.mockResolvedValue(mockLocations);
  mockStorageService.getBucketsList.mockResolvedValue(mockBucketsList);
}

describe('StorageManagementPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockNavigate.mockClear();
    setupMocks();
  });

  it('should render the page title', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });
    expect(screen.getByText('Storage Management')).toBeInTheDocument();
  });

  it('should show loading spinner initially', () => {
    mockStorageService.getLocations.mockReturnValue(new Promise(() => {}));
    mockStorageService.getBucketsList.mockReturnValue(new Promise(() => {}));
    render(<StorageManagementPage />);
    expect(screen.getByLabelText('Loading storage locations')).toBeInTheDocument();
  });

  it('should render storage locations table', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });
    expect(screen.getByText('bucket-2')).toBeInTheDocument();
    expect(screen.getByText('pvc-data')).toBeInTheDocument();
    expect(screen.getByText('pvc-models')).toBeInTheDocument();
  });

  it('should show S3 and PVC type labels', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });
    const s3Labels = screen.getAllByText('S3');
    const pvcLabels = screen.getAllByText('PVC');
    expect(s3Labels).toHaveLength(2);
    expect(pvcLabels).toHaveLength(2);
  });

  it('should show error alert on load failure', async () => {
    mockStorageService.getLocations.mockRejectedValue(new Error('Network error'));
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should show delete button only for S3 locations', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Delete bucket bucket-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete bucket bucket-2')).toBeInTheDocument();
    expect(screen.queryByLabelText('Delete bucket pvc-data')).not.toBeInTheDocument();
  });

  it('should filter locations by search text', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Filter by name...');
    await userEvent.type(searchInput, 'pvc');

    expect(screen.queryByText('bucket-1')).not.toBeInTheDocument();
    expect(screen.getByText('pvc-data')).toBeInTheDocument();
    expect(screen.getByText('pvc-models')).toBeInTheDocument();
  });

  it('should open create bucket modal', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Create Bucket'));
    expect(screen.getByText('Create S3 Bucket')).toBeInTheDocument();
  });

  it('should validate bucket name in create modal', async () => {
    mockStorageService.createBucket.mockResolvedValue(undefined);

    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText('Create Bucket'));

    const input = screen.getByLabelText('Bucket name *');
    await userEvent.type(input, 'AB');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText(/must be between 3 and 63 characters/)).toBeInTheDocument();
    });
  });

  it('should open delete confirmation modal', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Delete bucket bucket-1'));
    expect(screen.getByText('Delete S3 Bucket')).toBeInTheDocument();
    expect(screen.getByText(/Type "bucket-1" to confirm/)).toBeInTheDocument();
  });

  it('should disable delete button until name matches', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Delete bucket bucket-1'));

    const deleteBtn = screen.getByRole('button', { name: 'Delete' });
    expect(deleteBtn).toBeDisabled();

    const input = screen.getByLabelText(/Type "bucket-1" to confirm/);
    await userEvent.type(input, 'bucket-1');
    expect(deleteBtn).toBeEnabled();
  });

  it('should navigate to storage browser on row click', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('bucket-1'));
    expect(mockNavigate).toHaveBeenCalledWith('/brewet/storage/browse/bucket-1');
  });

  it('should call refreshLocations on refresh button click', async () => {
    render(<StorageManagementPage />);
    await waitFor(() => {
      expect(screen.getByText('bucket-1')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByLabelText('Refresh'));
    await waitFor(() => {
      expect(mockStorageService.refreshLocations).toHaveBeenCalledWith('test-ns');
    });
  });
});
