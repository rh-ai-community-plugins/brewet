import { render, screen, waitFor, act } from '@testing-library/react';
import { ContainerWizard } from '../ContainerWizard/ContainerWizard';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useDataConnections } from '~/app/hooks/useDataConnections';
import { usePVCs } from '~/app/hooks/usePVCs';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { storageService } from '~/app/services/storageService';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useDataConnections');
jest.mock('~/app/hooks/usePVCs');
jest.mock('~/app/hooks/useBrewetContainer');
jest.mock('~/app/services/storageService');

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseDataConnections = useDataConnections as jest.MockedFunction<typeof useDataConnections>;
const mockUsePVCs = usePVCs as jest.MockedFunction<typeof usePVCs>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;
const mockStorageService = storageService as jest.Mocked<typeof storageService>;

const dcFixture = {
  metadata: { name: 'my-dc-secret', namespace: 'test-ns' },
};

const pvcFixture = {
  metadata: { name: 'my-pvc', namespace: 'test-ns' },
};

function setupMocks(contextOverrides = {}) {
  mockUseBrewetContext.mockReturnValue({
    selectedProject: 'test-ns',
    setSelectedProject: jest.fn(),
    containerStatus: 'running',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    projects: [],
    projectsLoading: false,
    projectsError: null,
    refreshProjects: jest.fn(),
    addProject: jest.fn(),
    isActioning: false,
    setIsActioning: jest.fn(),
    ...contextOverrides,
  });

  mockUseDataConnections.mockReturnValue({
    dataConnections: [dcFixture],
    loading: false,
    error: null,
    refresh: jest.fn(),
  });

  mockUsePVCs.mockReturnValue({
    pvcs: [pvcFixture],
    loading: false,
    error: null,
    refresh: jest.fn(),
  });

  mockUseBrewetContainer.mockReturnValue({
    selectedProject: 'test-ns',
    containerStatus: 'running',
    containerInfo: null,
    isActioning: false,
    startContainer: jest.fn(),
    stopContainer: jest.fn(),
    deleteContainer: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue([{ resource: 'Deployment', success: true }]),
    updateContainer: jest.fn().mockResolvedValue([{ resource: 'Deployment', success: true }]),
    refreshContainerStatus: jest.fn(),
  });

  mockStorageService.readSettingsSecret.mockResolvedValue({});
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ContainerWizard', () => {
  describe('create mode', () => {
    it('should start with blank state — no DC selected, no PVC mounts', () => {
      setupMocks();
      render(<ContainerWizard onClose={jest.fn()} />);

      const noneRadio = screen.getByRole('radio', { name: /None \(PVC storage only\)/i });
      expect(noneRadio).toBeChecked();

      const dcRadio = screen.getByRole('radio', { name: 'my-dc-secret' });
      expect(dcRadio).not.toBeChecked();
    });
  });

  describe('deployment status', () => {
    it('should show deployment status after successful creation', async () => {
      const onClose = jest.fn();
      const mockCreate = jest.fn().mockResolvedValue([
        { resource: 'Deployment', success: true },
        { resource: 'Service', success: true },
        { resource: 'NetworkPolicy', success: true },
      ]);

      setupMocks({ containerStatus: 'none' });
      mockUseBrewetContainer.mockReturnValue({
        selectedProject: 'test-ns',
        containerStatus: 'none',
        containerInfo: null,
        isActioning: false,
        startContainer: jest.fn(),
        stopContainer: jest.fn(),
        deleteContainer: jest.fn().mockResolvedValue(undefined),
        createContainer: mockCreate,
        updateContainer: jest.fn().mockResolvedValue([]),
        refreshContainerStatus: jest.fn(),
      });

      render(<ContainerWizard onClose={onClose} />);

      // Navigate to PVC Selection, Configuration, then Review
      for (let i = 0; i < 3; i++) {
        const nextBtns = screen.getAllByRole('button', { name: /Next/i });
        await act(async () => { nextBtns[0].click(); });
      }

      // Click Create
      const createButton = screen.getByRole('button', { name: /Create/i });
      await act(async () => { createButton.click(); });

      // Wizard should not close
      expect(onClose).not.toHaveBeenCalled();

      // Should show deployment status
      await waitFor(() => {
        expect(screen.getByText('Resources created')).toBeInTheDocument();
        expect(screen.getByText('Deployment')).toBeInTheDocument();
        expect(screen.getByText('Service')).toBeInTheDocument();
        expect(screen.getByText('NetworkPolicy')).toBeInTheDocument();
      });

      // Close button should be present in the modal footer
      const closeButtons = screen.getAllByRole('button', { name: /Close/i });
      expect(closeButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('edit mode', () => {
    it('should pre-select the Data Connection matching envFrom', async () => {
      setupMocks({
        containerInfo: {
          name: 'brewet-storage-backend',
          namespace: 'test-ns',
          replicas: 1,
          readyReplicas: 1,
          envFrom: [{ secretRef: { name: 'my-dc-secret' } }],
          volumes: [],
          volumeMounts: [],
        },
      });

      await act(async () => {
        render(<ContainerWizard isEditMode onClose={jest.fn()} />);
      });

      await waitFor(() => {
        const dcRadio = screen.getByRole('radio', { name: 'my-dc-secret' });
        expect(dcRadio).toBeChecked();
      });
    });

    it('should not pre-select a DC when envFrom does not match any available Data Connection', async () => {
      setupMocks({
        containerInfo: {
          name: 'brewet-storage-backend',
          namespace: 'test-ns',
          replicas: 1,
          readyReplicas: 1,
          envFrom: [{ secretRef: { name: 'unknown-secret' } }],
          volumes: [],
          volumeMounts: [],
        },
      });

      await act(async () => {
        render(<ContainerWizard isEditMode onClose={jest.fn()} />);
      });

      await waitFor(() => {
        const noneRadio = screen.getByRole('radio', { name: /None \(PVC storage only\)/i });
        expect(noneRadio).toBeChecked();
      });
    });

    it('should defer initialization until data connections finish loading', async () => {
      mockUseBrewetContext.mockReturnValue({
        selectedProject: 'test-ns',
        setSelectedProject: jest.fn(),
        projects: [],
        projectsLoading: false,
        projectsError: null,
        refreshProjects: jest.fn(),
        addProject: jest.fn(),
        containerStatus: 'running',
        containerInfo: {
          name: 'brewet-storage-backend',
          namespace: 'test-ns',
          replicas: 1,
          readyReplicas: 1,
          envFrom: [{ secretRef: { name: 'my-dc-secret' } }],
          volumes: [],
          volumeMounts: [],
        },
        refreshContainerStatus: jest.fn(),
        isActioning: false,
        setIsActioning: jest.fn(),
      });

      mockUseDataConnections.mockReturnValue({
        dataConnections: [],
        loading: true,
        error: null,
        refresh: jest.fn(),
      });

      mockUsePVCs.mockReturnValue({ pvcs: [], loading: false, error: null, refresh: jest.fn() });

      mockUseBrewetContainer.mockReturnValue({
        selectedProject: 'test-ns',
        containerStatus: 'running',
        containerInfo: null,
        isActioning: false,
        startContainer: jest.fn(),
        stopContainer: jest.fn(),
        deleteContainer: jest.fn(),
        createContainer: jest.fn().mockResolvedValue([]),
        updateContainer: jest.fn().mockResolvedValue([]),
        refreshContainerStatus: jest.fn(),
      });

      mockStorageService.readSettingsSecret.mockResolvedValue({});

      const { rerender } = render(<ContainerWizard isEditMode onClose={jest.fn()} />);

      // While loading, DC is not initialized yet
      // Now data finishes loading
      mockUseDataConnections.mockReturnValue({
        dataConnections: [dcFixture],
        loading: false,
        error: null,
        refresh: jest.fn(),
      });

      await act(async () => {
        rerender(<ContainerWizard isEditMode onClose={jest.fn()} />);
      });

      await waitFor(() => {
        const dcRadio = screen.getByRole('radio', { name: 'my-dc-secret' });
        expect(dcRadio).toBeChecked();
      });
    });

    it('should reset initialization when wizard closes and reopens', async () => {
      setupMocks({
        containerInfo: {
          name: 'brewet-storage-backend',
          namespace: 'test-ns',
          replicas: 1,
          readyReplicas: 1,
          envFrom: [{ secretRef: { name: 'my-dc-secret' } }],
          volumes: [],
          volumeMounts: [],
        },
      });

      const onClose = jest.fn();
      const { unmount } = render(<ContainerWizard isEditMode onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'my-dc-secret' })).toBeChecked();
      });

      // Unmount simulates the wizard being removed from the DOM (parent conditional rendering)
      unmount();

      // Remount — should re-initialize from containerInfo
      await act(async () => {
        render(<ContainerWizard isEditMode onClose={onClose} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'my-dc-secret' })).toBeChecked();
      });
    });
  });
});
