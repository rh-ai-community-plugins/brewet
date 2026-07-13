import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useProjects } from '~/app/hooks/useProjects';
import { useK8sResources } from '~/app/hooks/useK8sResources';
import { useAccessReview } from '~/app/hooks/useAccessReview';
import ClusterResourcesPage from '../ClusterResourcesPage';

jest.mock('~/app/hooks/useProjects');
jest.mock('~/app/hooks/useK8sResources');
jest.mock('~/app/hooks/useAccessReview');

const mockProjects = [
  { metadata: { name: 'project-a', uid: 'uid-a' } },
  { metadata: { name: 'project-b', uid: 'uid-b' } },
];

const mockDeployments = [
  {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: {
      name: 'my-deploy',
      namespace: 'project-a',
      uid: 'dep-1',
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { replicas: 2 },
    status: { readyReplicas: 2, availableReplicas: 2 },
  },
];

const mockServices = [
  {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: 'my-svc',
      namespace: 'project-a',
      uid: 'svc-1',
      creationTimestamp: '2024-01-01T00:00:00Z',
    },
    spec: { ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }] },
  },
];

const mockRefresh = jest.fn();

function setupK8sMock(deployments: unknown[] = [], services: unknown[] = []) {
  (useK8sResources as jest.Mock).mockImplementation((path: string | null) => {
    if (!path) {
      return { items: [], loading: false, error: null, refresh: mockRefresh };
    }
    if (path.includes('deployments')) {
      return { items: deployments, loading: false, error: null, refresh: mockRefresh };
    }
    if (path.includes('services')) {
      return { items: services, loading: false, error: null, refresh: mockRefresh };
    }
    return { items: [], loading: false, error: null, refresh: mockRefresh };
  });
}

function mockAccessReview(overrides: { allowed?: boolean; loading?: boolean } = {}) {
  const { allowed = true, loading = false } = overrides;
  const results = ['deployments', 'services', 'configmaps', 'secrets'].flatMap((resource) =>
    ['get', 'list', 'create', 'delete'].map((verb) => ({
      verb,
      resource,
      group: resource === 'deployments' ? 'apps' : '',
      allowed,
    })),
  );
  (useAccessReview as jest.Mock).mockReturnValue({ results, loading, error: null });
}

describe('ClusterResourcesPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockAccessReview();
  });

  it('shows project selector', () => {
    (useProjects as jest.Mock).mockReturnValue({
      projects: mockProjects,
      loading: false,
      error: null,
    });
    setupK8sMock();

    render(<ClusterResourcesPage />);

    expect(screen.getByLabelText('Select a project')).toBeInTheDocument();
    expect(screen.getByText('Select a project')).toBeInTheDocument();
  });

  it('shows deployment and service cards after project selection', async () => {
    const user = userEvent.setup();

    (useProjects as jest.Mock).mockReturnValue({
      projects: mockProjects,
      loading: false,
      error: null,
    });
    setupK8sMock(mockDeployments, mockServices);

    render(<ClusterResourcesPage />);

    // Select a project
    const toggle = screen.getByLabelText('Select a project');
    await user.click(toggle);

    const option = await screen.findByText('project-a');
    await user.click(option);

    await waitFor(() => {
      expect(screen.getByText('Deployments')).toBeInTheDocument();
      expect(screen.getByText('Services')).toBeInTheDocument();
    });
  });

  it('shows empty state when no resources exist', async () => {
    const user = userEvent.setup();

    (useProjects as jest.Mock).mockReturnValue({
      projects: mockProjects,
      loading: false,
      error: null,
    });
    setupK8sMock([], []);

    render(<ClusterResourcesPage />);

    // Select a project
    const toggle = screen.getByLabelText('Select a project');
    await user.click(toggle);

    const option = await screen.findByText('project-a');
    await user.click(option);

    await waitFor(() => {
      expect(screen.getByText('No deployments found in this namespace.')).toBeInTheDocument();
      expect(screen.getByText('No services found in this namespace.')).toBeInTheDocument();
    });
  });

  it('shows deployment list with resource data', async () => {
    const user = userEvent.setup();

    (useProjects as jest.Mock).mockReturnValue({
      projects: mockProjects,
      loading: false,
      error: null,
    });
    setupK8sMock(mockDeployments, mockServices);

    render(<ClusterResourcesPage />);

    // Select a project
    const toggle = screen.getByLabelText('Select a project');
    await user.click(toggle);

    const option = await screen.findByText('project-a');
    await user.click(option);

    await waitFor(() => {
      expect(screen.getByText('my-deploy')).toBeInTheDocument();
      expect(screen.getByText('2/2 ready')).toBeInTheDocument();
      expect(screen.getByText('my-svc')).toBeInTheDocument();
    });
  });

  it('disables create buttons when user lacks RBAC permissions', async () => {
    const user = userEvent.setup();

    (useProjects as jest.Mock).mockReturnValue({
      projects: mockProjects,
      loading: false,
      error: null,
    });
    setupK8sMock(mockDeployments, mockServices);
    mockAccessReview({ allowed: false });

    render(<ClusterResourcesPage />);

    const toggle = screen.getByLabelText('Select a project');
    await user.click(toggle);

    const option = await screen.findByText('project-a');
    await user.click(option);

    await waitFor(() => {
      const createDeployBtn = screen.getByText('Create Deployment').closest('button');
      const createSvcBtn = screen.getByText('Create Service').closest('button');
      expect(createDeployBtn).toBeDisabled();
      expect(createSvcBtn).toBeDisabled();
    });
  });

  it('can open the create deployment modal', async () => {
    const user = userEvent.setup();

    (useProjects as jest.Mock).mockReturnValue({
      projects: mockProjects,
      loading: false,
      error: null,
    });
    setupK8sMock(mockDeployments, mockServices);

    render(<ClusterResourcesPage />);

    // Select a project first
    const toggle = screen.getByLabelText('Select a project');
    await user.click(toggle);

    const option = await screen.findByText('project-a');
    await user.click(option);

    // Click "Create Deployment" button
    const createButton = await screen.findByText('Create Deployment');
    await user.click(createButton);

    // Verify modal appears
    await waitFor(() => {
      expect(screen.getByLabelText('Deployment name')).toBeInTheDocument();
      expect(screen.getByLabelText('Container image')).toBeInTheDocument();
      expect(screen.getByLabelText('Replicas')).toBeInTheDocument();
      expect(screen.getByLabelText('Container port')).toBeInTheDocument();
    });
  });
});
