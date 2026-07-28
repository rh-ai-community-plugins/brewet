import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextInput,
} from '@patternfly/react-core';

const FOLDER_NAME_REGEX_S3 = /^[a-zA-Z0-9!._*'()-]+$/;
const FOLDER_NAME_REGEX_LOCAL = /^[a-zA-Z0-9._-]+$/;

function validateFolderName(name: string, storageType: 's3' | 'pvc'): string | null {
  if (!name) return 'Folder name is required.';
  if (name.includes('/')) return 'Folder name cannot contain slashes.';
  if (name === '.' || name === '..') return 'Invalid folder name.';
  if (storageType === 's3') {
    if (!FOLDER_NAME_REGEX_S3.test(name)) {
      return "Folder name can only contain letters, numbers, and ! . _ * ' ( ) -";
    }
  } else {
    if (!FOLDER_NAME_REGEX_LOCAL.test(name)) {
      return 'Folder name can only contain letters, numbers, periods, underscores, and hyphens.';
    }
  }
  return null;
}

interface CreateFolderModalProps {
  isOpen: boolean;
  storageType: 's3' | 'pvc';
  onConfirm: (folderName: string) => Promise<void>;
  onClose: () => void;
}

const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  storageType,
  onConfirm,
  onClose,
}) => {
  const [folderName, setFolderName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    const validationError = validateFolderName(folderName, storageType);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsCreating(true);
    setError(null);
    try {
      await onConfirm(folderName);
      setFolderName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create folder.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setFolderName('');
    setError(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      aria-label="Create folder"
      variant="small"
    >
      <ModalHeader title="Create Folder" />
      <ModalBody>
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
        >
          <FormGroup label="Folder name" isRequired fieldId="folder-name">
            <TextInput
              id="folder-name"
              value={folderName}
              onChange={(_event, value) => {
                setFolderName(value);
                setError(null);
              }}
              isRequired
              validated={error ? 'error' : 'default'}
            />
            {error && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant="error">{error}</HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleCreate}
          isLoading={isCreating}
          isDisabled={isCreating || !folderName}
        >
          Create
        </Button>
        <Button variant="link" onClick={handleClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateFolderModal;
