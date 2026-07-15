import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ContainerWizard } from '../ContainerWizard/ContainerWizard';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useDataConnections } from '~/app/hooks/useDataConnections';
import { usePVCs } from '~/app/hooks/usePVCs';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useDataConnections');
jest.mock('~/app/hooks/usePVCs');
jest.mock('~/app/hooks/useBrewetContainer');

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseDataConnections = useDataConnections as jest.MockedFunction<typeof useDataConnections>;
const mockUsePVCs = usePVCs as jest.MockedFunction<typeof usePVCs>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;

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
    ...contextOverrides,
  });

  mockUseDataConnections.mockReturnValue({
    dataConnections: [dcFixture],
    loading: false,
    error: null,
  });

  mockUsePVCs.mockReturnValue({
    pvcs: [pvcFixture],
    loading: false,
    error: null,
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
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('ContainerWizard', () => {
  describe('create mode', () => {
    it('should start with blank state — no DC selected, no PVC mounts', () => {
      setupMocks();
      render(<ContainerWizard isOpen onClose={jest.fn()} />);

      const noneRadio = screen.getByRole('radio', { name: /None \(PVC storage only\)/i });
      expect(noneRadio).toBeChecked();

      const dcRadio = screen.getByRole('radio', { name: 'my-dc-secret' });
      expect(dcRadio).not.toBeChecked();
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
        render(<ContainerWizard isOpen isEditMode onClose={jest.fn()} />);
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
        render(<ContainerWizard isOpen isEditMode onClose={jest.fn()} />);
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
      });

      mockUseDataConnections.mockReturnValue({
        dataConnections: [],
        loading: true,
        error: null,
      });

      mockUsePVCs.mockReturnValue({ pvcs: [], loading: false, error: null });

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

      const { rerender } = render(<ContainerWizard isOpen isEditMode onClose={jest.fn()} />);

      // While loading, DC is not initialized yet
      // Now data finishes loading
      mockUseDataConnections.mockReturnValue({
        dataConnections: [dcFixture],
        loading: false,
        error: null,
      });

      await act(async () => {
        rerender(<ContainerWizard isOpen isEditMode onClose={jest.fn()} />);
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
      const { rerender } = render(<ContainerWizard isOpen isEditMode onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'my-dc-secret' })).toBeChecked();
      });

      // Close the wizard
      rerender(<ContainerWizard isOpen={false} isEditMode onClose={onClose} />);

      // Reopen — should re-initialize from containerInfo
      await act(async () => {
        rerender(<ContainerWizard isOpen isEditMode onClose={onClose} />);
      });

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: 'my-dc-secret' })).toBeChecked();
      });
    });
  });
});
