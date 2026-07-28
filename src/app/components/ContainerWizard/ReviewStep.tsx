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
import { DataConnection, PvcMount, ContainerSettings } from '~/app/types/k8s';

interface ReviewStepProps {
  namespace: string;
  dataConnection: DataConnection | null;
  pvcMounts: PvcMount[];
  settings?: ContainerSettings;
  isCreating: boolean;
  createError: string | null;
}

function maskToken(value: string): string {
  if (!value || value.length <= 4) return '****';
  return value.slice(0, 4) + '****';
}

export const ReviewStep: React.FC<ReviewStepProps> = ({
  namespace,
  dataConnection,
  pvcMounts,
  settings,
  isCreating,
  createError,
}) => {
  const hasSettings = settings && (
    settings.hfToken || settings.httpProxy || settings.httpsProxy ||
    settings.maxConcurrentTransfers != null || settings.maxFilesPerPage != null
  );

  return (
  <Stack hasGutter>
    <StackItem>
      <Content component="p">
        Review the configuration before creating.
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
        {hasSettings && (
          <>
            {settings.hfToken && (
              <DescriptionListGroup>
                <DescriptionListTerm>HuggingFace Token</DescriptionListTerm>
                <DescriptionListDescription>{maskToken(settings.hfToken)}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {settings.httpProxy && (
              <DescriptionListGroup>
                <DescriptionListTerm>HTTP Proxy</DescriptionListTerm>
                <DescriptionListDescription>{settings.httpProxy}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {settings.httpsProxy && (
              <DescriptionListGroup>
                <DescriptionListTerm>HTTPS Proxy</DescriptionListTerm>
                <DescriptionListDescription>{settings.httpsProxy}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {settings.maxConcurrentTransfers != null && (
              <DescriptionListGroup>
                <DescriptionListTerm>Max Concurrent Transfers</DescriptionListTerm>
                <DescriptionListDescription>{settings.maxConcurrentTransfers}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
            {settings.maxFilesPerPage != null && (
              <DescriptionListGroup>
                <DescriptionListTerm>Max Files Per Page</DescriptionListTerm>
                <DescriptionListDescription>{settings.maxFilesPerPage}</DescriptionListDescription>
              </DescriptionListGroup>
            )}
          </>
        )}
      </DescriptionList>
    </StackItem>
    {isCreating && (
      <StackItem>
        <Spinner aria-label="Creating Brewet resources" size="lg" />
        <Content component="p">Creating Brewet resources...</Content>
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
};
