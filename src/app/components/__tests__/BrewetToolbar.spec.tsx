import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrewetToolbar } from '../BrewetToolbar';
import { useBrewetContext } from '~/app/context/BrewetContext';

jest.mock('~/app/context/BrewetContext');

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
});
jest.mock('~/app/components/ProjectSelector', () => ({
  ProjectSelector: ({ selectedProject }: { selectedProject: string | null }) => (
    <div data-testid="project-selector">{selectedProject ?? 'none'}</div>
  ),
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;

function mockContext(overrides: Partial<ReturnType<typeof useBrewetContext>> = {}) {
  mockUseBrewetContext.mockReturnValue({
    selectedProject: null,
    setSelectedProject: jest.fn(),
    containerStatus: 'none',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    ...overrides,
  });
}

describe('BrewetToolbar', () => {
  it('should render the project selector', () => {
    mockContext();
    render(<BrewetToolbar />);
    expect(screen.getByTestId('project-selector')).toBeInTheDocument();
  });

  it('should not show container controls when no project is selected', () => {
    mockContext();
    render(<BrewetToolbar />);
    expect(screen.queryByText('No Container')).not.toBeInTheDocument();
  });

  it('should show container status when a project is selected', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    render(<BrewetToolbar />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('should show stop button when container is running', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    render(<BrewetToolbar />);
    expect(screen.getByLabelText('Stop container')).toBeInTheDocument();
  });

  it('should show start button when container is stopped', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'stopped' });
    render(<BrewetToolbar />);
    expect(screen.getByLabelText('Start container')).toBeInTheDocument();
  });

  it('should show no container status when container does not exist', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'none' });
    render(<BrewetToolbar />);
    expect(screen.getByText('No Container')).toBeInTheDocument();
    expect(screen.queryByLabelText('Start container')).not.toBeInTheDocument();
  });

  it('should call fetch with scale endpoint on start click', async () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'stopped' });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Start container'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/namespaces/test-ns/deployments/brewet-storage-backend/scale'),
        expect.objectContaining({ method: 'PUT' }),
      );
    });
  });

  it('should call refreshContainerStatus on HTTP error response', async () => {
    const refreshContainerStatus = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    mockContext({ selectedProject: 'test-ns', containerStatus: 'stopped', refreshContainerStatus });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Start container'));

    await waitFor(() => {
      expect(refreshContainerStatus).toHaveBeenCalled();
    });
  });

  it('should call refreshContainerStatus on network error', async () => {
    const refreshContainerStatus = jest.fn();
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));
    mockContext({ selectedProject: 'test-ns', containerStatus: 'stopped', refreshContainerStatus });
    render(<BrewetToolbar />);

    await userEvent.click(screen.getByLabelText('Start container'));

    await waitFor(() => {
      expect(refreshContainerStatus).toHaveBeenCalled();
    });
  });

  it('should render edit button as disabled', () => {
    mockContext({ selectedProject: 'test-ns', containerStatus: 'running' });
    render(<BrewetToolbar />);
    expect(screen.getByLabelText('Edit container configuration')).toBeDisabled();
  });
});
