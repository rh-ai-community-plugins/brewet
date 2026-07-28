import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  Button,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Stack,
  StackItem,
  Content,
  Wizard,
  WizardStep,
} from '@patternfly/react-core';
import { CheckCircleIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useDataConnections } from '~/app/hooks/useDataConnections';
import { usePVCs } from '~/app/hooks/usePVCs';
import { useBrewetContainer, CreateResourceResult } from '~/app/hooks/useBrewetContainer';
import { storageService } from '~/app/services/storageService';
import { DataConnection, PvcMount, ContainerConfig, ContainerSettings } from '~/app/types/k8s';
import { validateMountPath } from '~/app/utils/k8sResources';
import { DataConnectionStep } from '~/app/components/ContainerWizard/DataConnectionStep';
import { PvcSelectionStep } from '~/app/components/ContainerWizard/PvcSelectionStep';
import { ConfigurationStep } from '~/app/components/ContainerWizard/ConfigurationStep';
import { ReviewStep } from '~/app/components/ContainerWizard/ReviewStep';

interface ContainerWizardProps {
  onClose: () => void;
  isEditMode?: boolean;
}

export const ContainerWizard: React.FC<ContainerWizardProps> = ({
  onClose,
  isEditMode = false,
}) => {
  const { selectedProject, containerInfo, containerStatus } = useBrewetContext();
  const { dataConnections, loading: dcLoading, error: dcError } = useDataConnections(selectedProject);
  const { pvcs, loading: pvcLoading, error: pvcError } = usePVCs(selectedProject);
  const { createContainer, updateContainer, isActioning } = useBrewetContainer();

  const [selectedDc, setSelectedDc] = useState<DataConnection | null>(null);
  const [pvcMounts, setPvcMounts] = useState<PvcMount[]>([]);
  const [settings, setSettings] = useState<ContainerSettings>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [createResults, setCreateResults] = useState<CreateResourceResult[]>([]);

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

    if (selectedProject) {
      storageService.readSettingsSecret(selectedProject).then((restored) => {
        setSettings(restored);
      }).catch(() => {});
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

  const hasMountPathErrors = useMemo(() => {
    if (pvcMounts.length === 0) return false;
    return pvcMounts.some((mount, i) => {
      const otherPaths = pvcMounts.filter((_, j) => j !== i).map((m) => m.mountPath);
      return validateMountPath(mount.mountPath, otherPaths) !== null;
    });
  }, [pvcMounts]);

  const canSave = !hasMountPathErrors && !isActioning;

  const handleSave = useCallback(async () => {
    if (!selectedProject || !canSave) return;
    setCreateError(null);

    const config: ContainerConfig = {
      dataConnection: selectedDc,
      pvcMounts,
      settings,
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

    if (isEditMode) {
      await Promise.all([
        storageService.updateProxySettings(selectedProject, {
          httpProxy: settings.httpProxy ?? '',
          httpsProxy: settings.httpsProxy ?? '',
        }),
        storageService.updateHuggingFaceSettings(selectedProject, {
          hfToken: settings.hfToken ?? '',
        }),
        storageService.updateMaxConcurrentTransfers(
          selectedProject,
          settings.maxConcurrentTransfers ?? 2,
        ),
        storageService.updateMaxFilesPerPage(
          selectedProject,
          settings.maxFilesPerPage ?? 100,
        ),
      ]).catch(() => {});
      onClose();
    } else {
      setCreateResults(results);
      setIsDeploying(true);
    }
  }, [selectedProject, canSave, selectedDc, pvcMounts, settings, isEditMode, createContainer, updateContainer, onClose]);

  const handleClose = useCallback(() => {
    setSelectedDc(null);
    setPvcMounts([]);
    setSettings({});
    setCreateError(null);
    onClose();
  }, [onClose]);

  if (isDeploying) {
    const isRunning = containerStatus === 'running';
    const isError = containerStatus === 'error';

    return (
      <Modal
        variant="large"
        isOpen={true}
        onClose={onClose}
        aria-label="Deploying Brewet"
      >
        <ModalHeader
          title="Deploying Brewet"
          description={`Project: ${selectedProject ?? ''}`}
        />
        <ModalBody>
          <Stack hasGutter>
            <StackItem>
              <Content component="h4">Resources created</Content>
              <List isPlain>
                {createResults.map((r) => (
                  <ListItem key={r.resource} icon={<CheckCircleIcon color="var(--pf-t--global--color--status--success--default)" />}>
                    {r.resource}
                  </ListItem>
                ))}
              </List>
            </StackItem>
            <StackItem>
              <Content component="h4">Brewet status</Content>
              {!isRunning && !isError && (
                <Content component="p">
                  <Spinner size="md" /> Brewet is starting…
                </Content>
              )}
              {isRunning && (
                <Content component="p">
                  <CheckCircleIcon color="var(--pf-t--global--color--status--success--default)" /> Brewet is running
                </Content>
              )}
              {isError && (
                <Content component="p">
                  <ExclamationCircleIcon color="var(--pf-t--global--color--status--danger--default)" /> Brewet failed to start
                </Content>
              )}
            </StackItem>
          </Stack>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <Modal
      variant="large"
      isOpen={true}
      onClose={handleClose}
      aria-label={isEditMode ? 'Edit Brewet configuration' : 'Set up Brewet'}
    >
      <ModalHeader
        title={isEditMode ? 'Edit Brewet Configuration' : 'Set Up Brewet'}
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
            name="Configuration"
            id="configuration"
          >
            <ConfigurationStep
              settings={settings}
              onChange={setSettings}
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
              settings={settings}
              isCreating={isActioning}
              createError={createError}
            />
          </WizardStep>
        </Wizard>
      </ModalBody>
    </Modal>
  );
};
