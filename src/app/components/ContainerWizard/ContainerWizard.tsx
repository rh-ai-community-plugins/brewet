import React, { useState, useCallback, useMemo } from 'react';
import {
  Modal,
  ModalBody,
  ModalHeader,
  Wizard,
  WizardStep,
} from '@patternfly/react-core';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useDataConnections } from '~/app/hooks/useDataConnections';
import { usePVCs } from '~/app/hooks/usePVCs';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { DataConnection, PvcMount, ContainerConfig } from '~/app/types/k8s';
import { validateMountPath } from '~/app/utils/k8sResources';
import { DataConnectionStep } from './DataConnectionStep';
import { PvcSelectionStep } from './PvcSelectionStep';
import { ReviewStep } from './ReviewStep';

interface ContainerWizardProps {
  isOpen: boolean;
  onClose: () => void;
  isEditMode?: boolean;
}

export const ContainerWizard: React.FC<ContainerWizardProps> = ({
  isOpen,
  onClose,
  isEditMode = false,
}) => {
  const { selectedProject } = useBrewetContext();
  const { dataConnections, loading: dcLoading, error: dcError } = useDataConnections(selectedProject);
  const { pvcs, loading: pvcLoading, error: pvcError } = usePVCs(selectedProject);
  const { createContainer, updateContainer, isActioning } = useBrewetContainer();

  const [selectedDc, setSelectedDc] = useState<DataConnection | null>(null);
  const [pvcMounts, setPvcMounts] = useState<PvcMount[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const hasSelection = selectedDc !== null || pvcMounts.length > 0;

  const hasMountPathErrors = useMemo(() => {
    if (pvcMounts.length === 0) return false;
    return pvcMounts.some((mount, i) => {
      const otherPaths = pvcMounts.filter((_, j) => j !== i).map((m) => m.mountPath);
      return validateMountPath(mount.mountPath, otherPaths) !== null;
    });
  }, [pvcMounts]);

  const canSave = hasSelection && !hasMountPathErrors && !isActioning;

  const handleSave = useCallback(async () => {
    if (!selectedProject || !canSave) return;
    setCreateError(null);

    const config: ContainerConfig = {
      dataConnection: selectedDc,
      pvcMounts,
    };

    const results = isEditMode
      ? await updateContainer(config)
      : await createContainer(config);

    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      setCreateError(failures.map((f) => `${f.resource}: ${f.error}`).join('; '));
      return;
    }

    onClose();
  }, [selectedProject, canSave, selectedDc, pvcMounts, isEditMode, createContainer, updateContainer, onClose]);

  const handleClose = useCallback(() => {
    setSelectedDc(null);
    setPvcMounts([]);
    setCreateError(null);
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <Modal
      variant="large"
      isOpen={isOpen}
      onClose={handleClose}
      aria-label={isEditMode ? 'Edit container configuration' : 'Create storage container'}
    >
      <ModalHeader
        title={isEditMode ? 'Edit Container Configuration' : 'Create Storage Container'}
        description={`Project: ${selectedProject ?? ''}`}
      />
      <ModalBody>
        <Wizard
          onSave={handleSave}
          onClose={handleClose}
          height={400}
        >
          <WizardStep
            name="Data Connection"
            id="data-connection"
          >
            <DataConnectionStep
              dataConnections={dataConnections}
              loading={dcLoading}
              error={dcError}
              selectedConnection={selectedDc}
              onSelect={setSelectedDc}
            />
          </WizardStep>
          <WizardStep
            name="PVC Selection"
            id="pvc-selection"
          >
            <PvcSelectionStep
              pvcs={pvcs}
              loading={pvcLoading}
              error={pvcError}
              selectedMounts={pvcMounts}
              onMountsChange={setPvcMounts}
            />
          </WizardStep>
          <WizardStep
            name="Review"
            id="review"
            footer={{
              isNextDisabled: !canSave,
              nextButtonText: isEditMode ? 'Save' : 'Create',
            }}
          >
            <ReviewStep
              namespace={selectedProject ?? ''}
              dataConnection={selectedDc}
              pvcMounts={pvcMounts}
              isCreating={isActioning}
              createError={createError}
            />
          </WizardStep>
        </Wizard>
      </ModalBody>
    </Modal>
  );
};
