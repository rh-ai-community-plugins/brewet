import React from 'react';
import {
  Alert,
  Content,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Label,
  LabelGroup,
  Stack,
  StackItem,
  Spinner,
} from '@patternfly/react-core';
import { DataConnection, PvcMount } from '~/app/types/k8s';

interface ReviewStepProps {
  namespace: string;
  dataConnection: DataConnection | null;
  pvcMounts: PvcMount[];
  isCreating: boolean;
  createError: string | null;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  namespace,
  dataConnection,
  pvcMounts,
  isCreating,
  createError,
}) => (
  <Stack hasGutter>
    <StackItem>
      <Content component="p">
        Review the container configuration before creating.
      </Content>
    </StackItem>
    <StackItem>
      <DescriptionList isHorizontal>
        <DescriptionListGroup>
          <DescriptionListTerm>Project</DescriptionListTerm>
          <DescriptionListDescription>{namespace}</DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>Data Connection</DescriptionListTerm>
          <DescriptionListDescription>
            {dataConnection ? dataConnection.metadata.name : 'None (PVC only)'}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>PVC Mounts</DescriptionListTerm>
          <DescriptionListDescription>
            {pvcMounts.length === 0 ? (
              'None (S3 only)'
            ) : (
              <LabelGroup>
                {pvcMounts.map((m) => (
                  <Label key={m.pvc.metadata.name}>
                    {m.pvc.metadata.name} → {m.mountPath}
                  </Label>
                ))}
              </LabelGroup>
            )}
          </DescriptionListDescription>
        </DescriptionListGroup>
      </DescriptionList>
    </StackItem>
    {isCreating && (
      <StackItem>
        <Spinner aria-label="Creating container resources" size="lg" />
        <Content component="p">Creating container resources...</Content>
      </StackItem>
    )}
    {createError && (
      <StackItem>
        <Alert variant="danger" isInline title="Creation failed">
          {createError}
        </Alert>
      </StackItem>
    )}
  </Stack>
);
