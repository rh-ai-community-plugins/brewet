import { render, screen, waitFor } from '@testing-library/react';
import StorageBrowserPage from '../StorageBrowserPage';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { storageService } from '~/app/services/storageService';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useBrewetContainer');
jest.mock('~/app/services/storageService');

jest.mock('~/app/components/ContainerWizard', () => ({
  ContainerWizard: () => null,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;
const mockStorageService = storageService as jest.Mocked<typeof storageService>;

beforeEach(() => {
  jest.resetAllMocks();
  mockUseBrewetContext.mockReturnValue({
    selectedProject: 'test-ns',
    setSelectedProject: jest.fn(),
    containerStatus: 'running',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    isActioning: false,
    setIsActioning: jest.fn(),
  });
  mockUseBrewetContainer.mockReturnValue({
    selectedProject: 'test-ns',
    containerStatus: 'running',
    containerInfo: null,
    isActioning: false,
    startContainer: jest.fn(),
    stopContainer: jest.fn(),
    deleteContainer: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue([]),
    updateContainer: jest.fn().mockResolvedValue([]),
    refreshContainerStatus: jest.fn(),
  });
  mockStorageService.getLocations.mockResolvedValue([]);
});

describe('StorageBrowserPage', () => {
  it('should render the page title', async () => {
    render(<StorageBrowserPage />);
    expect(screen.getByText('Storage Browser')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockStorageService.getLocations).toHaveBeenCalled();
    });
  });

  it('should show select project message when no project selected', () => {
    mockUseBrewetContext.mockReturnValue({
      selectedProject: null,
      setSelectedProject: jest.fn(),
      containerStatus: 'none',
      containerInfo: null,
      refreshContainerStatus: jest.fn(),
      isActioning: false,
      setIsActioning: jest.fn(),
    });
    render(<StorageBrowserPage />);
    expect(screen.getByText('Select a project')).toBeInTheDocument();
  });

  it('should show storage browser content when container is running', () => {
    mockStorageService.getLocations.mockReturnValue(new Promise(() => {}));
    render(<StorageBrowserPage />);
    expect(screen.getByLabelText('Loading storage locations')).toBeInTheDocument();
  });
});
