import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  TextInput,
  Alert,
  Content,
} from '@patternfly/react-core';
import type { FileInfo } from '~/app/types/storage';

interface DeleteConfirmationModalProps {
  target: FileInfo;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const DeleteConfirmationModal: React.FC<DeleteConfirmationModalProps> = ({
  target,
  onConfirm,
  onClose,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState('');

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onConfirm();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete.');
      setIsDeleting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-label={`Delete ${target.name}`}
      variant="small"
    >
      <ModalHeader
        title={`Delete ${target.isDirectory ? 'Folder' : 'File'}`}
      />
      <ModalBody>
        {target.isDirectory && (
          <Alert
            variant="warning"
            title="Recursive deletion"
            isInline
            isPlain
            className="pf-v6-u-mb-md"
          >
            All files and subfolders inside this folder will be permanently deleted.
          </Alert>
        )}
        <Content className="pf-v6-u-mb-md">
          Are you sure you want to delete{' '}
          <strong>{target.name}</strong>? This action cannot be undone.
        </Content>
        <Form onSubmit={(e) => { e.preventDefault(); if (confirmName === target.name) handleDelete(); }}>
          <FormGroup label={`Type "${target.name}" to confirm`} isRequired fieldId="delete-confirm-name">
            <TextInput
              id="delete-confirm-name"
              value={confirmName}
              onChange={(_event, value) => setConfirmName(value)}
              isRequired
            />
          </FormGroup>
        </Form>
        {deleteError && (
          <Alert variant="danger" title="Delete failed" isInline className="pf-v6-u-mt-md">
            {deleteError}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="danger"
          onClick={handleDelete}
          isLoading={isDeleting}
          isDisabled={isDeleting || confirmName !== target.name}
        >
          Delete
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default DeleteConfirmationModal;
