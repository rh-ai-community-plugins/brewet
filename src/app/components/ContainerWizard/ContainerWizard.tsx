import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { DataConnectionStep } from '~/app/components/ContainerWizard/DataConnectionStep';
import { PvcSelectionStep } from '~/app/components/ContainerWizard/PvcSelectionStep';
import { ReviewStep } from '~/app/components/ContainerWizard/ReviewStep';

interface ContainerWizardProps {
  onClose: () => void;
  isEditMode?: boolean;
}

export const ContainerWizard: React.FC<ContainerWizardProps> = ({
  onClose,
  isEditMode = false,
}) => {
  const { selectedProject, containerInfo } = useBrewetContext();
  const { dataConnections, loading: dcLoading, error: dcError } = useDataConnections(selectedProject);
  const { pvcs, loading: pvcLoading, error: pvcError } = usePVCs(selectedProject);
  const { createContainer, updateContainer, isActioning } = useBrewetContainer();

  const [selectedDc, setSelectedDc] = useState<DataConnection | null>(null);
  const [pvcMounts, setPvcMounts] = useState<PvcMount[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!isEditMode || hasInitialized.current) return;
    if (dcLoading || pvcLoading) return;

    hasInitialized.current = true;

    if (!containerInfo) return;

    if (containerInfo.envFrom && containerInfo.envFrom.length > 0) {
      const secretName = containerInfo.envFrom[0].secretRef.name;
      const match = dataConnections.find((dc) => dc.metadata.name === secretName);
      if (match) setSelectedDc(match);
    }

    if (containerInfo.volumeMounts && containerInfo.volumes) {
      const mounts: PvcMount[] = [];
      for (const vm of containerInfo.volumeMounts) {
        const vol = containerInfo.volumes.find((v) => v.name === vm.name);
        if (!vol?.persistentVolumeClaim) continue;
        const pvc = pvcs.find((p) => p.metadata.name === vol.persistentVolumeClaim!.claimName);
        if (pvc) {
          mounts.push({ pvc, mountPath: vm.mountPath });
        }
      }
      setPvcMounts(mounts);
    }
  }, [isEditMode, dcLoading, pvcLoading, dataConnections, pvcs, containerInfo]);

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

    const wasAborted = results.some((r) => r.resource === 'Operation' && r.error === 'Aborted');
    if (wasAborted) return;

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

  return (
    <Modal
      variant="large"
      isOpen={true}
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
