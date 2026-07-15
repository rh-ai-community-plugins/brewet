import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrewetToolbar } from '../BrewetToolbar';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useBrewetContainer');

jest.mock('~/app/components/ProjectSelector', () => ({
  ProjectSelector: ({ selectedProject }: { selectedProject: string | null }) => (
    <div data-testid="project-selector">{selectedProject ?? 'none'}</div>
  ),
}));

jest.mock('~/app/components/ContainerWizard', () => ({
  ContainerWizard: () => <div data-testid="container-wizard">Wizard</div>,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;

function mockContext(overrides: Partial<ReturnType<typeof useBrewetContext>> = {}) {
  mockUseBrewetContext.mockReturnValue({
    selectedProject: null,
    setSelectedProject: jest.fn(),
    containerStatus: 'none',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    isActioning: false,
    setIsActioning: jest.fn(),
    ...overrides,
  });
}

function mockContainer(overrides: Partial<ReturnType<typeof useBrewetContainer>> = {}) {
  mockUseBrewetContainer.mockReturnValue({
    selectedProject: null,
    containerStatus: 'none',
    containerInfo: null,
    isActioning: false,
    startContainer: jest.fn(),
    stopContainer: jest.fn(),
    deleteContainer: jest.fn().mockResolvedValue(true),
    createContainer: jest.fn().mockResolvedValue([]),
    updateContainer: jest.fn().mockResolvedValue([]),
    refreshContainerStatus: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('BrewetToolbar', () => {
  it('should render the project selector', () => {
    mockContext();
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.getByTestId('project-selector')).toBeInTheDocument();
  });

  it('should not show container controls when no project is selected', () => {
    mockContext();
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.queryByText('No Container')).not.toBeInTheDocument();
  });

  it('should show container status when a project is selected', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('should show stop button when container is running', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.getByLabelText('Stop container')).toBeInTheDocument();
  });

  it('should show start button when container is stopped', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'stopped' });
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.getByLabelText('Start container')).toBeInTheDocument();
  });

  it('should call startContainer on start click', async () => {
    const startContainer = jest.fn();
    mockContext({ selectedProject: 'test-ns', containerStatus: 'stopped' });
    mockContainer({ startContainer });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Start container'));
    expect(startContainer).toHaveBeenCalled();
  });

  it('should call stopContainer on stop click', async () => {
    const stopContainer = jest.fn();
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer({ stopContainer });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Stop container'));
    expect(stopContainer).toHaveBeenCalled();
  });

  it('should show Create Container button when no container exists', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'none' });
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.getByText('Create Container')).toBeInTheDocument();
  });

  it('should open wizard when Create Container is clicked', async () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'none' });
    mockContainer();
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByText('Create Container'));
    expect(screen.getByTestId('container-wizard')).toBeInTheDocument();
  });

  it('should show edit and delete buttons when container exists', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer();
    render(<BrewetToolbar />);
    expect(screen.getByLabelText('Edit container configuration')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete container')).toBeInTheDocument();
  });

  it('should show delete confirmation modal', async () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer();
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Delete container'));
    expect(screen.getByText('Delete storage container?')).toBeInTheDocument();
  });

  it('should call deleteContainer on confirm delete', async () => {
    const deleteContainer = jest.fn().mockResolvedValue(true);
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer({ deleteContainer });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Delete container'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(deleteContainer).toHaveBeenCalled();
    });
  });

  it('should close modal when deleteContainer succeeds', async () => {
    const deleteContainer = jest.fn().mockResolvedValue(true);
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer({ deleteContainer });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Delete container'));
    expect(screen.getByText('Delete storage container?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.queryByText('Delete storage container?')).not.toBeInTheDocument();
    });
  });

  it('should keep modal open and show error when deleteContainer fails', async () => {
    const deleteContainer = jest.fn().mockResolvedValue(false);
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer({ deleteContainer });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Delete container'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText('Delete storage container?')).toBeInTheDocument();
      expect(screen.getByText('Failed to delete the storage container. Check your permissions and try again.')).toBeInTheDocument();
    });
  });

  it('should clear error when modal is closed after failure', async () => {
    const deleteContainer = jest.fn().mockResolvedValue(false);
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer({ deleteContainer });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Delete container'));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(screen.getByText('Failed to delete the storage container. Check your permissions and try again.')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByLabelText('Delete container'));
    expect(screen.queryByText('Failed to delete the storage container. Check your permissions and try again.')).not.toBeInTheDocument();
  });

  it('should disable buttons when isActioning is true', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    mockContainer({ isActioning: true });
    render(<BrewetToolbar />);

    expect(screen.getByLabelText('Stop container')).toBeDisabled();
    expect(screen.getByLabelText('Edit container configuration')).toBeDisabled();
    expect(screen.getByLabelText('Delete container')).toBeDisabled();
  });
});
