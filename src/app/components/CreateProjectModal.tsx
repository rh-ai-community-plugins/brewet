import React, { useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Popover,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { HelpIcon } from '@patternfly/react-icons';

const RESOURCE_NAME_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_RESOURCE_NAME_LENGTH = 30;

function toResourceName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_RESOURCE_NAME_LENGTH);
}

type ValidationStatus = 'default' | 'success' | 'error';

function validateResourceName(value: string): { lengthStatus: ValidationStatus; formatStatus: ValidationStatus } {
  const lengthStatus: ValidationStatus =
    !value ? 'default' : value.length <= MAX_RESOURCE_NAME_LENGTH ? 'success' : 'error';
  const formatStatus: ValidationStatus =
    !value ? 'default' : RESOURCE_NAME_REGEX.test(value) ? 'success' : 'error';
  return { lengthStatus, formatStatus };
}

export interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (projectName: string) => void;
}

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  isOpen,
  onClose,
  onCreated,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [resourceName, setResourceName] = useState('');
  const [resourceNameEdited, setResourceNameEdited] = useState(false);
  const [showResourceName, setShowResourceName] = useState(false);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveResourceName = resourceNameEdited ? resourceName : toResourceName(displayName);

  const { lengthStatus, formatStatus } = useMemo(
    () => validateResourceName(effectiveResourceName),
    [effectiveResourceName],
  );

  const isValid = effectiveResourceName.length > 0 && lengthStatus !== 'error' && formatStatus !== 'error';

  const resetForm = useCallback(() => {
    setDisplayName('');
    setResourceName('');
    setResourceNameEdited(false);
    setShowResourceName(false);
    setDescription('');
    setIsSubmitting(false);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;

    setIsSubmitting(true);
    setError(null);

    const body = {
      apiVersion: 'project.openshift.io/v1',
      kind: 'ProjectRequest',
      metadata: { name: effectiveResourceName },
      ...(displayName && { displayName }),
      ...(description && { description }),
    };

    try {
      const res = await fetch('/api/k8s/apis/project.openshift.io/v1/projectrequests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `Failed to create project (${res.status})`);
      }

      await fetch(
        `/api/k8s/api/v1/namespaces/${effectiveResourceName}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/merge-patch+json' },
          body: JSON.stringify({
            metadata: { labels: { 'opendatahub.io/dashboard': 'true' } },
          }),
        },
      );

      const projectName = effectiveResourceName;
      resetForm();
      onCreated(projectName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIsSubmitting(false);
    }
  }, [isValid, effectiveResourceName, displayName, description, onCreated, resetForm]);

  return (
    <Modal
      variant="small"
      isOpen={isOpen}
      onClose={handleClose}
      aria-label="Create project"
    >
      <ModalHeader title="Create project" />
      <ModalBody>
        {error && (
          <Alert variant="danger" isInline title={error} className="pf-v6-u-mb-md" />
        )}
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <FormGroup label="Name" isRequired fieldId="create-project-name">
            <TextInput
              id="create-project-name"
              value={displayName}
              onChange={(_, value) => setDisplayName(value)}
              isRequired
              autoFocus
            />
            {!showResourceName && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    <Button
                      variant="link"
                      isInline
                      onClick={() => setShowResourceName(true)}
                    >
                      Edit resource name
                    </Button>
                    {' '}
                    <Popover
                      bodyContent="The resource name is used to identify the project in the Kubernetes API and must follow DNS naming conventions."
                    >
                      <Button variant="plain" isInline aria-label="Resource name help">
                        <HelpIcon />
                      </Button>
                    </Popover>
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
          {showResourceName && (
            <FormGroup
              label="Resource name"
              isRequired
              fieldId="create-project-resource-name"
              labelHelp={
                <Popover
                  bodyContent="The resource name is used to identify the project in the Kubernetes API and must follow DNS naming conventions."
                >
                  <Button variant="plain" isInline aria-label="Resource name help">
                    <HelpIcon />
                  </Button>
                </Popover>
              }
            >
              <TextInput
                id="create-project-resource-name"
                value={effectiveResourceName}
                onChange={(_, value) => {
                  setResourceName(value);
                  setResourceNameEdited(true);
                }}
                validated={
                  lengthStatus === 'error' || formatStatus === 'error' ? 'error' : 'default'
                }
                isRequired
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant={lengthStatus}>
                    Cannot exceed {MAX_RESOURCE_NAME_LENGTH} characters
                  </HelperTextItem>
                  <HelperTextItem variant={formatStatus}>
                    Must start and end with a letter or number. Valid characters include lowercase
                    letters, numbers, and hyphens (-).
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
          <FormGroup label="Description" fieldId="create-project-description">
            <TextArea
              id="create-project-description"
              value={description}
              onChange={(_, value) => setDescription(value)}
              resizeOrientation="vertical"
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleSubmit}
          isLoading={isSubmitting}
          isDisabled={isSubmitting || !isValid}
        >
          Create
        </Button>
        <Button variant="link" onClick={handleClose} isDisabled={isSubmitting}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};
