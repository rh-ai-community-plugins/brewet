import React from 'react';
import {
  FormGroup,
  Radio,
  Alert,
  Spinner,
  Content,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { DataConnection } from '~/app/types/k8s';

interface DataConnectionStepProps {
  dataConnections: DataConnection[];
  loading: boolean;
  error: string | null;
  selectedConnection: DataConnection | null;
  onSelect: (dc: DataConnection | null) => void;
}

export const DataConnectionStep: React.FC<DataConnectionStepProps> = ({
  dataConnections,
  loading,
  error,
  selectedConnection,
  onSelect,
}) => {
  if (loading) {
    return <Spinner aria-label="Loading data connections" />;
  }

  if (error) {
    return <Alert variant="danger" isInline title="Failed to load data connections">{error}</Alert>;
  }

  return (
    <Stack hasGutter>
      <StackItem>
        <Content component="p">
          Select a Data Connection to provide S3 credentials. You may proceed without
          one if you only need PVC storage.
        </Content>
      </StackItem>
      <StackItem>
        <FormGroup role="radiogroup" fieldId="data-connection-selection" label="Data Connections">
          <Radio
            id="dc-none"
            name="data-connection"
            label="None (PVC storage only)"
            isChecked={selectedConnection === null}
            onChange={() => onSelect(null)}
          />
          {dataConnections.map((dc) => {
            let endpoint: string | undefined;
            try {
              endpoint = dc.data?.AWS_S3_ENDPOINT
                ? atob(dc.data.AWS_S3_ENDPOINT)
                : undefined;
            } catch {
              endpoint = '(invalid encoding)';
            }
            return (
              <Radio
                key={dc.metadata.name}
                id={`dc-${dc.metadata.name}`}
                name="data-connection"
                label={dc.metadata.name}
                description={endpoint ? `Endpoint: ${endpoint}` : undefined}
                isChecked={selectedConnection?.metadata.name === dc.metadata.name}
                onChange={() => onSelect(dc)}
              />
            );
          })}
        </FormGroup>
      </StackItem>
      {dataConnections.length === 0 && (
        <StackItem>
          <Alert variant="info" isInline title="No Data Connections found">
            No S3 Data Connections were found in this project. You can still set up
            Brewet with PVC storage only, or create a Data Connection in the RHOAI
            dashboard first.
          </Alert>
        </StackItem>
      )}
    </Stack>
  );
};
