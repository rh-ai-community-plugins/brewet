import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContainerRequired } from '../ContainerRequired';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useBrewetContainer');

jest.mock('~/app/components/ContainerWizard', () => ({
  ContainerWizard: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="container-wizard">Wizard</div> : null,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;

function mockContext(overrides: Partial<ReturnType<typeof useBrewetContext>> = {}) {
  mockUseBrewetContext.mockReturnValue({
    selectedProject: 'test-ns',
    setSelectedProject: jest.fn(),
    containerStatus: 'running',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    ...overrides,
  });
}

function mockContainer(overrides: Partial<ReturnType<typeof useBrewetContainer>> = {}) {
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
    ...overrides,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ContainerRequired', () => {
  it('should show select project message when no project is selected', () => {
    mockContext({ selectedProject: null });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);
    expect(screen.getByText('Select a project')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('should show no container message when container does not exist', () => {
    mockContext({ containerStatus: 'none' });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);
    expect(screen.getByText('No storage container')).toBeInTheDocument();
    expect(screen.getByText('Create Container')).toBeInTheDocument();
  });

  it('should open wizard when Create Container is clicked', async () => {
    mockContext({ containerStatus: 'none' });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);

    await userEvent.click(screen.getByText('Create Container'));
    expect(screen.getByTestId('container-wizard')).toBeInTheDocument();
  });

  it('should show stopped message with start button', () => {
    mockContext({ containerStatus: 'stopped' });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);
    expect(screen.getByText('Container stopped')).toBeInTheDocument();
    expect(screen.getByText('Start Container')).toBeInTheDocument();
  });

  it('should call startContainer on start click', async () => {
    const startContainer = jest.fn();
    mockContext({ containerStatus: 'stopped' });
    mockContainer({ startContainer });
    render(<ContainerRequired><div>content</div></ContainerRequired>);

    await userEvent.click(screen.getByText('Start Container'));
    expect(startContainer).toHaveBeenCalled();
  });

  it('should render children when container is running', () => {
    mockContext({ containerStatus: 'running' });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('should render children when container is starting', () => {
    mockContext({ containerStatus: 'starting' });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('should render children when container is in error state', () => {
    mockContext({ containerStatus: 'error' });
    mockContainer();
    render(<ContainerRequired><div>content</div></ContainerRequired>);
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
