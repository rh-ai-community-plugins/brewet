import React, { useState, useCallback } from 'react';
import {
  PageSection,
  Title,
  Content,
  Card,
  CardBody,
  CardTitle,
  Stack,
  StackItem,
  Split,
  SplitItem,
  Button,
  Alert,
  Spinner,
  Bullseye,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Form,
  FormGroup,
  TextInput,
  Tooltip,
} from '@patternfly/react-core';
import { CubesIcon, PlusCircleIcon, SyncAltIcon } from '@patternfly/react-icons';
import { ProjectSelector } from '~/app/components/ProjectSelector';
import {
  useK8sResources,
  createK8sResource,
  K8sResource,
} from '~/app/hooks/useK8sResources';
import { useAccessReview } from '~/app/hooks/useAccessReview';

type DeploymentResource = K8sResource & {
  spec: { replicas?: number };
  status: { readyReplicas?: number; availableReplicas?: number };
};

type ServiceResource = K8sResource & {
  spec: { ports?: { port: number; targetPort: number; protocol: string }[] };
};

const ResourceTable: React.FC<{
  resources: K8sResource[];
  kind: string;
}> = ({ resources, kind }) => {
  if (resources.length === 0) {
    return (
      <Content component="p" className="pf-v6-u-color-200">
        No {kind.toLowerCase()}s found in this namespace.
      </Content>
    );
  }

  return (
    <table className="pf-v6-c-table pf-m-compact pf-m-grid-md" aria-label={`${kind} list`}>
      <thead>
        <tr>
          <th>Name</th>
          <th>Created</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {resources.map((r) => (
          <tr key={r.metadata.uid}>
            <td style={{ paddingTop: '8px', paddingBottom: '8px' }}>{r.metadata.name}</td>
            <td style={{ paddingTop: '8px', paddingBottom: '8px' }}>{new Date(r.metadata.creationTimestamp).toLocaleString()}</td>
            <td style={{ paddingTop: '8px', paddingBottom: '8px' }}>
              {kind === 'Deployment' ? (
                <Label color="blue">
                  {(r as DeploymentResource).status?.readyReplicas ?? 0}/
                  {(r as DeploymentResource).spec?.replicas ?? 0} ready
                </Label>
              ) : (
                <Label color="blue">Active</Label>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const CreateDeploymentModal: React.FC<{
  namespace: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}> = ({ namespace, isOpen, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [replicas, setReplicas] = useState('1');
  const [port, setPort] = useState('8080');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setImage('');
    setReplicas('1');
    setPort('8080');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await createK8sResource(
        `/apis/apps/v1/namespaces/${namespace}/deployments`,
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name, namespace },
          spec: {
            replicas: parseInt(replicas, 10),
            selector: { matchLabels: { app: name } },
            template: {
              metadata: { labels: { app: name } },
              spec: {
                containers: [
                  {
                    name,
                    image,
                    ports: [{ containerPort: parseInt(port, 10) }],
                  },
                ],
              },
            },
          },
        },
      );
      onCreated();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create deployment');
    } finally {
      setCreating(false);
    }
  };

  const isValid = name.length > 0 && image.length > 0;

  return (
    <Modal variant="medium" isOpen={isOpen} onClose={handleClose} aria-label="Create Deployment">
      <ModalHeader title="Create Deployment" />
      <ModalBody>
        <Form>
          {error && (
            <Alert variant="danger" title="Creation failed" isInline>
              {error}
            </Alert>
          )}
          <FormGroup label="Name" isRequired fieldId="deploy-name">
            <TextInput
              id="deploy-name"
              value={name}
              onChange={(_event, val) => setName(val)}
              isRequired
              aria-label="Deployment name"
            />
          </FormGroup>
          <FormGroup label="Container Image" isRequired fieldId="deploy-image">
            <TextInput
              id="deploy-image"
              value={image}
              onChange={(_event, val) => setImage(val)}
              placeholder="e.g. nginx:latest"
              isRequired
              aria-label="Container image"
            />
          </FormGroup>
          <FormGroup label="Replicas" fieldId="deploy-replicas">
            <TextInput
              id="deploy-replicas"
              type="number"
              value={replicas}
              onChange={(_event, val) => setReplicas(val)}
              aria-label="Replicas"
            />
          </FormGroup>
          <FormGroup label="Container Port" fieldId="deploy-port">
            <TextInput
              id="deploy-port"
              type="number"
              value={port}
              onChange={(_event, val) => setPort(val)}
              aria-label="Container port"
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleCreate}
          isDisabled={!isValid || creating}
          isLoading={creating}
        >
          Create
        </Button>
        <Button variant="link" onClick={handleClose} isDisabled={creating}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

const CreateServiceModal: React.FC<{
  namespace: string;
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}> = ({ namespace, isOpen, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [port, setPort] = useState('80');
  const [targetPort, setTargetPort] = useState('8080');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setPort('80');
    setTargetPort('8080');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      await createK8sResource(`/api/v1/namespaces/${namespace}/services`, {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, namespace },
        spec: {
          selector: { app: name },
          ports: [
            {
              port: parseInt(port, 10),
              targetPort: parseInt(targetPort, 10),
              protocol: 'TCP',
            },
          ],
        },
      });
      onCreated();
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create service');
    } finally {
      setCreating(false);
    }
  };

  const isValid = name.length > 0;

  return (
    <Modal variant="medium" isOpen={isOpen} onClose={handleClose} aria-label="Create Service">
      <ModalHeader title="Create Service" />
      <ModalBody>
        <Form>
          {error && (
            <Alert variant="danger" title="Creation failed" isInline>
              {error}
            </Alert>
          )}
          <FormGroup label="Name" isRequired fieldId="svc-name">
            <TextInput
              id="svc-name"
              value={name}
              onChange={(_event, val) => setName(val)}
              isRequired
              aria-label="Service name"
            />
          </FormGroup>
          <FormGroup label="Port" fieldId="svc-port">
            <TextInput
              id="svc-port"
              type="number"
              value={port}
              onChange={(_event, val) => setPort(val)}
              aria-label="Service port"
            />
          </FormGroup>
          <FormGroup label="Target Port" fieldId="svc-target-port">
            <TextInput
              id="svc-target-port"
              type="number"
              value={targetPort}
              onChange={(_event, val) => setTargetPort(val)}
              aria-label="Target port"
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleCreate}
          isDisabled={!isValid || creating}
          isLoading={creating}
        >
          Create
        </Button>
        <Button variant="link" onClick={handleClose} isDisabled={creating}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

const ClusterResourcesPage: React.FC = () => {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const deploymentPath = selectedProject
    ? `/apis/apps/v1/namespaces/${selectedProject}/deployments`
    : null;
  const servicePath = selectedProject
    ? `/api/v1/namespaces/${selectedProject}/services`
    : null;

  const { results: accessResults, loading: accessLoading } = useAccessReview(selectedProject);

  const canDo = useCallback(
    (resource: string, verb: string) => {
      if (accessLoading) return false;
      return accessResults.find((r) => r.resource === resource && r.verb === verb)?.allowed ?? false;
    },
    [accessResults, accessLoading],
  );

  const {
    items: deployments,
    loading: deploymentsLoading,
    error: deploymentsError,
    refresh: refreshDeployments,
  } = useK8sResources<DeploymentResource>(deploymentPath);

  const {
    items: services,
    loading: servicesLoading,
    error: servicesError,
    refresh: refreshServices,
  } = useK8sResources<ServiceResource>(servicePath);

  const [isCreateDeployOpen, setIsCreateDeployOpen] = useState(false);
  const [isCreateServiceOpen, setIsCreateServiceOpen] = useState(false);

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Title headingLevel="h1" size="2xl">
            <CubesIcon /> Cluster Resources
          </Title>
          <Content component="p">
            This page demonstrates how to create and list Kubernetes resources through the
            dashboard&apos;s K8s API pass-through. All operations respect the authenticated
            user&apos;s RBAC permissions.
          </Content>
        </StackItem>

        <StackItem>
          <Card>
            <CardBody>
              <Stack hasGutter>
                <StackItem>
                  <Content component="p">
                    Select a project to manage resources.
                  </Content>
                </StackItem>
                <StackItem>
                  <ProjectSelector
                    selectedProject={selectedProject}
                    onSelect={setSelectedProject}
                  />
                </StackItem>
              </Stack>
            </CardBody>
          </Card>
        </StackItem>

        {selectedProject && (
          <>
            <StackItem>
              <Card>
                <CardTitle>
                  <Split hasGutter>
                    <SplitItem isFilled>Deployments</SplitItem>
                    <SplitItem>
                      <Button
                        variant="secondary"
                        icon={<SyncAltIcon />}
                        onClick={refreshDeployments}
                        aria-label="Refresh deployments"
                        isDisabled={deploymentsLoading}
                      />
                    </SplitItem>
                    <SplitItem>
                      <Tooltip
                        content="You don't have permission to create deployments in this namespace"
                        trigger={canDo('deployments', 'create') ? 'manual' : 'mouseenter focus'}
                      >
                        <Button
                          variant="primary"
                          icon={<PlusCircleIcon />}
                          onClick={() => setIsCreateDeployOpen(true)}
                          isDisabled={!canDo('deployments', 'create')}
                        >
                          Create Deployment
                        </Button>
                      </Tooltip>
                    </SplitItem>
                  </Split>
                </CardTitle>
                <CardBody>
                  {deploymentsError ? (
                    <Alert variant="danger" title="Failed to load deployments" isInline>
                      {deploymentsError}
                    </Alert>
                  ) : deploymentsLoading ? (
                    <Bullseye>
                      <Spinner aria-label="Loading deployments" />
                    </Bullseye>
                  ) : (
                    <ResourceTable
                      resources={deployments}
                      kind="Deployment"
                    />
                  )}
                </CardBody>
              </Card>
            </StackItem>

            <StackItem>
              <Card>
                <CardTitle>
                  <Split hasGutter>
                    <SplitItem isFilled>Services</SplitItem>
                    <SplitItem>
                      <Button
                        variant="secondary"
                        icon={<SyncAltIcon />}
                        onClick={refreshServices}
                        aria-label="Refresh services"
                        isDisabled={servicesLoading}
                      />
                    </SplitItem>
                    <SplitItem>
                      <Tooltip
                        content="You don't have permission to create services in this namespace"
                        trigger={canDo('services', 'create') ? 'manual' : 'mouseenter focus'}
                      >
                        <Button
                          variant="primary"
                          icon={<PlusCircleIcon />}
                          onClick={() => setIsCreateServiceOpen(true)}
                          isDisabled={!canDo('services', 'create')}
                        >
                          Create Service
                        </Button>
                      </Tooltip>
                    </SplitItem>
                  </Split>
                </CardTitle>
                <CardBody>
                  {servicesError ? (
                    <Alert variant="danger" title="Failed to load services" isInline>
                      {servicesError}
                    </Alert>
                  ) : servicesLoading ? (
                    <Bullseye>
                      <Spinner aria-label="Loading services" />
                    </Bullseye>
                  ) : (
                    <ResourceTable
                      resources={services}
                      kind="Service"
                    />
                  )}
                </CardBody>
              </Card>
            </StackItem>

            <CreateDeploymentModal
              namespace={selectedProject}
              isOpen={isCreateDeployOpen}
              onClose={() => setIsCreateDeployOpen(false)}
              onCreated={refreshDeployments}
            />

            <CreateServiceModal
              namespace={selectedProject}
              isOpen={isCreateServiceOpen}
              onClose={() => setIsCreateServiceOpen(false)}
              onCreated={refreshServices}
            />

          </>
        )}
      </Stack>
    </PageSection>
  );
};

export default ClusterResourcesPage;
