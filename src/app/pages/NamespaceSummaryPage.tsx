import React from 'react';
import {
  PageSection,
  Title,
  Content,
  Card,
  CardBody,
  CardHeader,
  Stack,
  StackItem,
  Spinner,
  Bullseye,
  Alert,
  Label,
  Button,
} from '@patternfly/react-core';
import { ServerIcon, SyncAltIcon } from '@patternfly/react-icons';
import { useNamespaceSummary } from '~/app/hooks/useNamespaceSummary';
import type { NamespaceInfo } from '~/app/hooks/useNamespaceSummary';

const PodCountCell: React.FC<{ count: number; color: 'green' | 'blue' | 'red' | 'grey' | 'orange' }> = ({ count, color }) => {
  if (count === 0) {
    return <>0</>;
  }
  return <Label color={color}>{count}</Label>;
};

const NamespaceSummaryPage: React.FC = () => {
  const { data, loading, error, refresh } = useNamespaceSummary();

  if (loading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label="Loading namespace summary" />
        </Bullseye>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1" size="2xl">
            <ServerIcon /> Namespace Summary
          </Title>
          <Content component="p">
            This page demonstrates the BFF (Backend For Frontend) pattern. The data shown here is
            aggregated server-side by the plugin&apos;s own backend service, which receives the
            user&apos;s authentication token through the dashboard proxy and makes multiple
            Kubernetes API calls to build this summary.
          </Content>
        </StackItem>

        {error && (
          <StackItem>
            <Alert variant="danger" title="Failed to load namespace summary" isInline>
              {error}
            </Alert>
          </StackItem>
        )}

        {data && (
          <StackItem>
            <Card>
              <CardHeader
                actions={{
                  actions: (
                    <Button
                      variant="secondary"
                      icon={<SyncAltIcon />}
                      onClick={refresh}
                      aria-label="Refresh namespace summary"
                    />
                  ),
                }}
              >
                <Title headingLevel="h2" size="lg">
                  Namespaces
                </Title>
              </CardHeader>
              <CardBody>
                {data.namespaces.length === 0 ? (
                  <Content component="p" className="pf-v6-u-color-200">
                    No namespaces found.
                  </Content>
                ) : (
                  <table className="pf-v6-c-table pf-m-compact pf-m-grid-md" aria-label="Namespace summary">
                    <thead>
                      <tr>
                        <th>Namespace</th>
                        <th>Phase</th>
                        <th>Total</th>
                        <th>Running</th>
                        <th>Pending</th>
                        <th>Succeeded</th>
                        <th>Failed</th>
                        <th>Unknown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.namespaces.map((ns: NamespaceInfo) => (
                        <tr key={ns.name}>
                          <td>{ns.name}</td>
                          <td>
                            <Label color={ns.phase === 'Active' ? 'green' : 'grey'}>{ns.phase}</Label>
                          </td>
                          <td>{ns.pods.total}</td>
                          <td><PodCountCell count={ns.pods.running} color="green" /></td>
                          <td><PodCountCell count={ns.pods.pending} color="blue" /></td>
                          <td><PodCountCell count={ns.pods.succeeded} color="grey" /></td>
                          <td><PodCountCell count={ns.pods.failed} color="red" /></td>
                          <td><PodCountCell count={ns.pods.unknown} color="orange" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardBody>
            </Card>
          </StackItem>
        )}
      </Stack>
    </PageSection>
  );
};

export default NamespaceSummaryPage;
