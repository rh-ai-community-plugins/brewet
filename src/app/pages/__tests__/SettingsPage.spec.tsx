import { render, screen } from '@testing-library/react';
import SettingsPage from '../SettingsPage';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useBrewetContainer');

jest.mock('~/app/components/ContainerWizard', () => ({
  ContainerWizard: () => null,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;

beforeEach(() => {
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
});

describe('SettingsPage', () => {
  it('should render the page title', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should render the coming soon placeholder when container is running', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
