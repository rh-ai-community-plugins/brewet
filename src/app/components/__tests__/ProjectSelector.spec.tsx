import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useBrewetContext, BrewetContextValue } from '~/app/context/BrewetContext';
import { ProjectSelector } from '../ProjectSelector';

jest.mock('~/app/context/BrewetContext');

const userProjects = [
  { metadata: { name: 'my-app', uid: 'uid-1' } },
  { metadata: { name: 'staging', uid: 'uid-2' } },
  { metadata: { name: 'production', uid: 'uid-3' } },
];

const systemProjects = [
  { metadata: { name: 'openshift-monitoring', uid: 'uid-s1' } },
  { metadata: { name: 'kube-system', uid: 'uid-s2' } },
  { metadata: { name: 'default', uid: 'uid-s3' } },
];

const allProjects = [...userProjects, ...systemProjects];

const baseContext: BrewetContextValue = {
  selectedProject: null,
  setSelectedProject: jest.fn(),
  projects: [],
  projectsLoading: false,
  projectsError: null,
  refreshProjects: jest.fn(),
  addProject: jest.fn(),
  containerStatus: 'none',
  containerInfo: null,
  refreshContainerStatus: jest.fn(),
  isActioning: false,
  setIsActioning: jest.fn(),
};

function mockContext(overrides: Partial<BrewetContextValue> = {}) {
  (useBrewetContext as jest.Mock).mockReturnValue({ ...baseContext, ...overrides });
}

const STORAGE_KEY = 'rhoai.project-favorites';

describe('ProjectSelector', () => {
  const onSelect = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    localStorage.clear();
  });

  it('shows placeholder when no project is selected', () => {
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);
    expect(screen.getByText('Select a project')).toBeInTheDocument();
  });

  it('shows selected project name in toggle', () => {
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject="my-app" onSelect={onSelect} />);
    expect(screen.getByText('Project: my-app')).toBeInTheDocument();
  });

  it('shows spinner when loading', () => {
    mockContext({ projectsLoading: true });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);
    expect(screen.getByLabelText('Loading projects')).toBeInTheDocument();
  });

  it('shows error alert on failure', () => {
    mockContext({ projectsError: 'Network error' });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('opens dropdown and shows projects sorted alphabetically', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));

    const items = await screen.findAllByRole('menuitem');
    const names = items.map((item) => item.textContent).filter(Boolean);
    expect(names).toEqual(['my-app', 'production', 'staging']);
  });

  it('hides system namespaces by default', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));

    await waitFor(() => {
      expect(screen.queryByText('openshift-monitoring')).not.toBeInTheDocument();
      expect(screen.queryByText('kube-system')).not.toBeInTheDocument();
      expect(screen.queryByText('default')).not.toBeInTheDocument();
    });
  });

  it('shows system namespaces when toggle is turned on', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.click(screen.getByLabelText('Show default projects'));

    await waitFor(() => {
      expect(screen.getByText('openshift-monitoring')).toBeInTheDocument();
      expect(screen.getByText('kube-system')).toBeInTheDocument();
    });
  });

  it('does not show system namespace toggle when no system namespaces exist', async () => {
    const user = userEvent.setup();
    mockContext({ projects: userProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));

    expect(screen.queryByText('Show default projects')).not.toBeInTheDocument();
  });

  it('filters projects by search text', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.type(screen.getByLabelText('Filter projects'), 'prod');

    await waitFor(() => {
      expect(screen.getByText('production')).toBeInTheDocument();
      expect(screen.queryByText('my-app')).not.toBeInTheDocument();
      expect(screen.queryByText('staging')).not.toBeInTheDocument();
    });
  });

  it('uses fuzzy matching for filter', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.type(screen.getByLabelText('Filter projects'), 'myap');

    await waitFor(() => {
      expect(screen.getByText('my-app')).toBeInTheDocument();
    });
  });

  it('shows empty state when filter matches nothing', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.type(screen.getByLabelText('Filter projects'), 'zzzzz');

    await waitFor(() => {
      expect(screen.getByText('No projects found')).toBeInTheDocument();
      expect(screen.getByText('Clear filters')).toBeInTheDocument();
    });
  });

  it('calls onSelect when a project is clicked', async () => {
    const user = userEvent.setup();
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.click(await screen.findByText('staging'));

    expect(onSelect).toHaveBeenCalledWith('staging');
  });

  it('can be disabled', () => {
    mockContext({ projects: allProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} isDisabled />);
    expect(screen.getByLabelText('Select a project')).toBeDisabled();
  });

  it('shows favorited projects in the Favorites group', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['staging']));
    mockContext({ projects: userProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));

    expect(screen.getByText('Favorites')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('toggles favorite when star icon is clicked', async () => {
    const user = userEvent.setup();
    mockContext({ projects: userProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));

    const starButtons = screen.getAllByLabelText('not starred');
    await user.click(starButtons[0]);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toContain('my-app');
  });

  it('filters favorites by search text', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['my-app', 'staging']));
    mockContext({ projects: userProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.type(screen.getByLabelText('Filter projects'), 'stag');

    await waitFor(() => {
      const items = screen.getAllByRole('menuitem');
      const names = items.map((item) => item.textContent);
      expect(names).toContain('staging');
      expect(names).not.toContain('my-app');
    });
  });

  it('closes dropdown when window loses focus', async () => {
    const user = userEvent.setup();
    mockContext({ projects: userProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event('blur')));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('hides Favorites group when no favorites match the filter', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['my-app']));
    mockContext({ projects: userProjects });
    render(<ProjectSelector selectedProject={null} onSelect={onSelect} />);

    await user.click(screen.getByLabelText('Select a project'));
    await user.type(screen.getByLabelText('Filter projects'), 'prod');

    await waitFor(() => {
      expect(screen.queryByText('Favorites')).not.toBeInTheDocument();
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });
  });
});
