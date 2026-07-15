import React, { useState, useCallback } from 'react';
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Button,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
} from '@patternfly/react-core';
import {
  PlayIcon,
  StopIcon,
  PencilAltIcon,
  TrashIcon,
  PlusCircleIcon,
} from '@patternfly/react-icons';
import { ProjectSelector } from '~/app/components/ProjectSelector';
import { useBrewetContext, ContainerStatus } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { ContainerWizard } from '~/app/components/ContainerWizard';

const STATUS_CONFIG: Record<ContainerStatus, { text: string; color: 'grey' | 'green' | 'blue' | 'red' }> = {
  none: { text: 'No Container', color: 'grey' },
  stopped: { text: 'Stopped', color: 'grey' },
  running: { text: 'Running', color: 'green' },
  starting: { text: 'Starting', color: 'blue' },
  error: { text: 'Error', color: 'red' },
};

export const BrewetToolbar: React.FC = () => {
  const {
    selectedProject,
    setSelectedProject,
    containerStatus,
  } = useBrewetContext();

  const {
    startContainer,
    stopContainer,
    deleteContainer,
    isActioning,
  } = useBrewetContainer();

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const statusConfig = STATUS_CONFIG[containerStatus];
  const canStart = containerStatus === 'stopped';
  const canStop = containerStatus === 'running' || containerStatus === 'starting' || containerStatus === 'error';
  const hasContainer = containerStatus !== 'none';

  const handleStartStop = useCallback(() => {
    if (isActioning) return;
    if (canStart) {
      startContainer();
    } else {
      stopContainer();
    }
  }, [isActioning, canStart, startContainer, stopContainer]);

  const handleDelete = useCallback(async () => {
    await deleteContainer();
    setIsDeleteModalOpen(false);
  }, [deleteContainer]);

  const openCreateWizard = useCallback(() => {
    setIsEditMode(false);
    setIsWizardOpen(true);
  }, []);

  const openEditWizard = useCallback(() => {
    setIsEditMode(true);
    setIsWizardOpen(true);
  }, []);

  return (
    <>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <ProjectSelector
              selectedProject={selectedProject}
              onSelect={setSelectedProject}
            />
          </ToolbarItem>

          {selectedProject && (
            <ToolbarGroup align={{ default: 'alignEnd' }}>
              <ToolbarItem>
                <Label
                  color={statusConfig.color}
                  icon={containerStatus === 'starting' ? <Spinner size="sm" /> : undefined}
                >
                  {statusConfig.text}
                </Label>
              </ToolbarItem>

              {!hasContainer && (
                <ToolbarItem>
                  <Button
                    variant="primary"
                    icon={<PlusCircleIcon />}
                    onClick={openCreateWizard}
                    isDisabled={isActioning}
                  >
                    Create Container
                  </Button>
                </ToolbarItem>
              )}

              {hasContainer && (canStart || canStop) && (
                <ToolbarItem>
                  <Button
                    variant="plain"
                    aria-label={canStart ? 'Start container' : 'Stop container'}
                    onClick={handleStartStop}
                    isDisabled={isActioning}
                    icon={canStart ? <PlayIcon /> : <StopIcon />}
                  />
                </ToolbarItem>
              )}

              {hasContainer && (
                <ToolbarItem>
                  <Button
                    variant="plain"
                    aria-label="Edit container configuration"
                    onClick={openEditWizard}
                    isDisabled={isActioning}
                    icon={<PencilAltIcon />}
                  />
                </ToolbarItem>
              )}

              {hasContainer && (
                <ToolbarItem>
                  <Button
                    variant="plain"
                    aria-label="Delete container"
                    onClick={() => setIsDeleteModalOpen(true)}
                    isDisabled={isActioning}
                    icon={<TrashIcon />}
                  />
                </ToolbarItem>
              )}
            </ToolbarGroup>
          )}
        </ToolbarContent>
      </Toolbar>

      <ContainerWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        isEditMode={isEditMode}
      />

      <Modal
        variant="small"
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        aria-label="Delete container confirmation"
      >
        <ModalHeader title="Delete storage container?" />
        <ModalBody>
          This will delete the storage backend Deployment, Service, and NetworkPolicy
          in project <strong>{selectedProject}</strong>. This action cannot be undone.
        </ModalBody>
        <ModalFooter>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={isActioning}
            isDisabled={isActioning}
          >
            Delete
          </Button>
          <Button
            variant="link"
            onClick={() => setIsDeleteModalOpen(false)}
            isDisabled={isActioning}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
};
