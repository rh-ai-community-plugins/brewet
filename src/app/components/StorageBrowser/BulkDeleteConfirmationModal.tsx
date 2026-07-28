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

interface BulkDeleteConfirmationModalProps {
  selectedFiles: Set<string>;
  sortedFiles: FileInfo[];
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

const BulkDeleteConfirmationModal: React.FC<BulkDeleteConfirmationModalProps> = ({
  selectedFiles,
  sortedFiles,
  onConfirm,
  onClose,
}) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const confirmTarget = selectedFiles.size === 1 ? [...selectedFiles][0] : 'confirm';

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onConfirm();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Some deletions failed.');
      setIsDeleting(false);
    }
  };

  const title = selectedFiles.size === 1
    ? (() => { const f = sortedFiles.find((sf) => selectedFiles.has(sf.name)); return `Delete ${f?.isDirectory ? 'Folder' : 'File'}`; })()
    : 'Delete Selected Items';

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-label="Bulk delete confirmation"
      variant="small"
    >
      <ModalHeader title={title} />
      <ModalBody>
        {sortedFiles.some((f) => f.isDirectory && selectedFiles.has(f.name)) && (
          <Alert
            variant="warning"
            title="Recursive deletion"
            isInline
            isPlain
            className="pf-v6-u-mb-md"
          >
            {selectedFiles.size === 1
              ? 'All files and subfolders inside this folder will be permanently deleted.'
              : 'Selected folders and all their contents will be permanently deleted.'}
          </Alert>
        )}
        <Content className="pf-v6-u-mb-md">
          {selectedFiles.size === 1 ? (
            <>Are you sure you want to delete <strong>{[...selectedFiles][0]}</strong>? This action cannot be undone.</>
          ) : (
            <>Are you sure you want to delete <strong>{selectedFiles.size}</strong> selected items? This action cannot be undone.</>
          )}
        </Content>
        <Form onSubmit={(e) => { e.preventDefault(); if (confirmText === confirmTarget) handleDelete(); }}>
          <FormGroup label={`Type "${confirmTarget}" to confirm`} isRequired fieldId="bulk-delete-confirm">
            <TextInput
              id="bulk-delete-confirm"
              value={confirmText}
              onChange={(_event, value) => setConfirmText(value)}
              isRequired
            />
          </FormGroup>
        </Form>
        {deleteError && (
          <Alert variant="danger" title="Some deletions failed" isInline className="pf-v6-u-mt-md">
            {deleteError}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="danger"
          onClick={handleDelete}
          isLoading={isDeleting}
          isDisabled={isDeleting || confirmText !== confirmTarget}
        >
          Delete {selectedFiles.size} Item{selectedFiles.size !== 1 ? 's' : ''}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default BulkDeleteConfirmationModal;
