import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  MultipleFileUpload,
  MultipleFileUploadMain,
  MultipleFileUploadStatus,
  MultipleFileUploadStatusItem,
} from '@patternfly/react-core';
import { UploadIcon } from '@patternfly/react-icons';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation } from '~/app/types/storage';

interface UploadState {
  file: File;
  relativePath: string;
  status: 'pending' | 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
}

interface UploadModalProps {
  isOpen: boolean;
  namespace: string;
  location: StorageLocation;
  currentPath: string;
  onClose: () => void;
  onComplete: () => void;
}

const UploadModal: React.FC<UploadModalProps> = ({
  isOpen,
  namespace,
  location,
  currentPath,
  onClose,
  onComplete,
}) => {
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [uploadStatusIcon, setUploadStatusIcon] = useState<'inProgress' | 'success' | 'danger'>('inProgress');
  const uploadAbortRef = useRef<AbortController | null>(null);

  const handleFileDrop = useCallback(
    async (_event: unknown, droppedFiles: File[]) => {
      uploadAbortRef.current?.abort();
      const controller = new AbortController();
      uploadAbortRef.current = controller;

      const newItems: UploadState[] = droppedFiles.map((file) => {
        const webkitPath = (file as { webkitRelativePath?: string }).webkitRelativePath;
        const directPath = (file as { path?: string }).path;
        let pathValue = webkitPath && webkitPath.trim() !== '' ? webkitPath
          : directPath && directPath.trim() !== '' ? directPath
          : file.name;
        if (pathValue.startsWith('./')) pathValue = pathValue.substring(2);
        if (pathValue.startsWith('/')) pathValue = pathValue.substring(1);
        if (!pathValue) pathValue = file.name;
        return { file, relativePath: pathValue, status: 'pending' as const };
      });

      setUploads((prev) => {
        const existingPaths = new Set(prev.map((u) => u.relativePath));
        const fresh = newItems.filter((item) => !existingPaths.has(item.relativePath));
        return [...prev, ...fresh];
      });

      for (const item of newItems) {
        if (controller.signal.aborted) {
          setUploads((prev) =>
            prev.map((u) =>
              u.relativePath === item.relativePath && u.status === 'pending'
                ? { ...u, status: 'cancelled' }
                : u,
            ),
          );
          continue;
        }

        setUploads((prev) =>
          prev.map((u) => u.relativePath === item.relativePath ? { ...u, status: 'uploading' } : u),
        );
        try {
          const filePath = currentPath
            ? `${currentPath}${item.relativePath}`
            : item.relativePath;
          await storageService.uploadFile(
            namespace,
            location,
            filePath,
            item.file,
            controller.signal,
          );
          setUploads((prev) =>
            prev.map((u) =>
              u.relativePath === item.relativePath ? { ...u, status: 'done' } : u,
            ),
          );
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            setUploads((prev) =>
              prev.map((u) =>
                u.relativePath === item.relativePath
                  ? { ...u, status: 'cancelled' }
                  : u.status === 'pending'
                    ? { ...u, status: 'cancelled' }
                    : u,
              ),
            );
            break;
          }
          setUploads((prev) =>
            prev.map((u) =>
              u.relativePath === item.relativePath
                ? { ...u, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
                : u,
            ),
          );
        }
      }

      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }

      onComplete();
    },
    [namespace, location, currentPath, onComplete],
  );

  const handleCancelUploads = useCallback(() => {
    uploadAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => { uploadAbortRef.current?.abort(); };
  }, []);

  const handleRemoveUpload = useCallback((pathsToRemove: string[]) => {
    const removeSet = new Set(pathsToRemove);
    setUploads((prev) => prev.filter((u) => !removeSet.has(u.relativePath)));
  }, []);

  useEffect(() => {
    if (uploads.length === 0) {
      setUploadStatusIcon('inProgress');
    } else if (uploads.every((u) => u.status === 'done' || u.status === 'error' || u.status === 'cancelled')) {
      setUploadStatusIcon(uploads.every((u) => u.status === 'done') ? 'success' : 'danger');
    } else {
      setUploadStatusIcon('inProgress');
    }
  }, [uploads]);

  const handleModalClose = useCallback(() => {
    if (uploads.some((u) => u.status === 'uploading' || u.status === 'pending')) return;
    uploadAbortRef.current?.abort();
    setUploads([]);
    onClose();
    onComplete();
  }, [uploads, onClose, onComplete]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      aria-label="Upload files"
      variant="medium"
    >
      <ModalHeader title="Upload files" />
      <ModalBody>
        <MultipleFileUpload
          onFileDrop={handleFileDrop}
          isHorizontal={false}
          dropzoneProps={{ noClick: false }}
        >
          <MultipleFileUploadMain
            titleIcon={<UploadIcon />}
            titleText="Drag and drop files or folders here, or click to browse."
          />
          {uploads.length > 0 && (
            <MultipleFileUploadStatus
              statusToggleText={
                uploads.some((u) => u.status === 'cancelled')
                  ? `${uploads.filter((u) => u.status === 'done').length} of ${uploads.length} files uploaded (cancelled)`
                  : `${uploads.filter((u) => u.status === 'done').length} of ${uploads.length} files uploaded`
              }
              statusToggleIcon={uploadStatusIcon}
              aria-label="Upload status"
            >
              {uploads.map((upload) => (
                <MultipleFileUploadStatusItem
                  key={upload.relativePath}
                  file={upload.file}
                  fileName={upload.relativePath}
                  onClearClick={() => handleRemoveUpload([upload.relativePath])}
                  customFileHandler={() => {}}
                  progressValue={
                    upload.status === 'done' ? 100
                      : upload.status === 'error' ? 100
                      : upload.status === 'cancelled' ? 100
                      : upload.status === 'uploading' ? undefined
                      : 0
                  }
                  progressVariant={
                    upload.status === 'done' ? 'success'
                      : upload.status === 'error' ? 'danger'
                      : upload.status === 'cancelled' ? 'warning'
                      : undefined
                  }
                />
              ))}
            </MultipleFileUploadStatus>
          )}
        </MultipleFileUpload>
      </ModalBody>
      <ModalFooter>
        {uploads.some((u) => u.status === 'uploading' || u.status === 'pending') && (
          <Button
            variant="danger"
            onClick={handleCancelUploads}
          >
            Cancel Upload
          </Button>
        )}
        <Button
          variant="primary"
          onClick={handleModalClose}
          isDisabled={uploads.some((u) => u.status === 'uploading' || u.status === 'pending')}
        >
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default UploadModal;
