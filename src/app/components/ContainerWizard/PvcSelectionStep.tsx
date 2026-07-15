import React from 'react';
import {
  Alert,
  Spinner,
  Content,
  Stack,
  StackItem,
  TextInput,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { PersistentVolumeClaim, PvcMount } from '~/app/types/k8s';
import { defaultMountPath } from '~/app/utils/k8sResources';

interface PvcSelectionStepProps {
  pvcs: PersistentVolumeClaim[];
  loading: boolean;
  error: string | null;
  selectedMounts: PvcMount[];
  onMountsChange: (mounts: PvcMount[]) => void;
}

export const PvcSelectionStep: React.FC<PvcSelectionStepProps> = ({
  pvcs,
  loading,
  error,
  selectedMounts,
  onMountsChange,
}) => {
  if (loading) {
    return <Spinner aria-label="Loading PVCs" />;
  }

  if (error) {
    return <Alert variant="danger" isInline title="Failed to load PVCs">{error}</Alert>;
  }

  const isSelected = (pvc: PersistentVolumeClaim) =>
    selectedMounts.some((m) => m.pvc.metadata.name === pvc.metadata.name);

  const getMountPath = (pvc: PersistentVolumeClaim) => {
    const mount = selectedMounts.find((m) => m.pvc.metadata.name === pvc.metadata.name);
    return mount?.mountPath ?? defaultMountPath(pvc.metadata.name);
  };

  const togglePvc = (pvc: PersistentVolumeClaim) => {
    if (isSelected(pvc)) {
      onMountsChange(selectedMounts.filter((m) => m.pvc.metadata.name !== pvc.metadata.name));
    } else {
      onMountsChange([...selectedMounts, { pvc, mountPath: defaultMountPath(pvc.metadata.name) }]);
    }
  };

  const updateMountPath = (pvcName: string, mountPath: string) => {
    onMountsChange(
      selectedMounts.map((m) =>
        m.pvc.metadata.name === pvcName ? { ...m, mountPath } : m,
      ),
    );
  };

  return (
    <Stack hasGutter>
      <StackItem>
        <Content component="p">
          Select PVCs to mount in the storage backend container. Each PVC will be
          accessible for file browsing.
        </Content>
      </StackItem>
      <StackItem>
        {pvcs.length === 0 ? (
          <Alert variant="info" isInline title="No PVCs found">
            No PersistentVolumeClaims were found in this project. You can still create a
            container with S3 storage only.
          </Alert>
        ) : (
          <Table aria-label="PVC selection" variant="compact">
            <Thead>
              <Tr>
                <Th screenReaderText="Select" />
                <Th>Name</Th>
                <Th>Capacity</Th>
                <Th>Status</Th>
                <Th>Mount Path</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pvcs.map((pvc) => {
                const selected = isSelected(pvc);
                return (
                  <Tr key={pvc.metadata.name}>
                    <Td
                      select={{
                        rowIndex: 0,
                        onSelect: () => togglePvc(pvc),
                        isSelected: selected,
                      }}
                    />
                    <Td dataLabel="Name">{pvc.metadata.name}</Td>
                    <Td dataLabel="Capacity">
                      {pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage ?? '-'}
                    </Td>
                    <Td dataLabel="Status">{pvc.status?.phase ?? '-'}</Td>
                    <Td dataLabel="Mount Path">
                      {selected ? (
                        <TextInput
                          aria-label={`Mount path for ${pvc.metadata.name}`}
                          value={getMountPath(pvc)}
                          onChange={(_e, val) => updateMountPath(pvc.metadata.name, val)}
                        />
                      ) : (
                        '-'
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </StackItem>
    </Stack>
  );
};
