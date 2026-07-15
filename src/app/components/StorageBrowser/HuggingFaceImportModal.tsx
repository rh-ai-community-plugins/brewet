import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Alert,
  Progress,
  ProgressMeasureLocation,
  Content,
} from '@patternfly/react-core';
import { storageService } from '~/app/services/storageService';
import { apiClient } from '~/app/services/apiClient';
import type { StorageLocation } from '~/app/types/storage';

const MODEL_ID_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;

interface TransferProgress {
  type: string;
  jobId: string;
  status: string;
  completedFiles?: number;
  totalFiles?: number;
  completedBytes?: number;
  totalBytes?: number;
  currentFile?: string;
  error?: string;
}

interface HuggingFaceImportModalProps {
  namespace: string;
  location: StorageLocation;
  currentPath: string;
  onClose: () => void;
  onComplete: () => void;
}

const HuggingFaceImportModal: React.FC<HuggingFaceImportModalProps> = ({
  namespace,
  location,
  currentPath,
  onClose,
  onComplete,
}) => {
  const [modelId, setModelId] = useState('');
  const [hfToken, setHfToken] = useState('');
  const [prefix, setPrefix] = useState('');
  const [modelIdError, setModelIdError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanupEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    return cleanupEventSource;
  }, [cleanupEventSource]);

  const handleSubmit = async () => {
    setModelIdError(null);
    setError(null);

    if (!modelId) {
      setModelIdError('Model ID is required.');
      return;
    }
    if (!MODEL_ID_REGEX.test(modelId) || modelId.length > 200) {
      setModelIdError('Model ID must be in owner/model format (e.g., meta-llama/Llama-2-7b).');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await storageService.importHuggingFace(namespace, {
        modelId,
        destinationType: location.type === 's3' ? 's3' : 'local',
        bucketName: location.type === 's3' ? location.id : undefined,
        localLocationId: location.type === 'pvc' ? location.id : undefined,
        localPath: currentPath || undefined,
        hfToken: hfToken || undefined,
        prefix: prefix || undefined,
      });

      setJobId(result.jobId);
      setProgress({
        type: 'progress',
        jobId: result.jobId,
        status: 'queued',
        totalFiles: result.fileCount,
        completedFiles: 0,
      });

      const sseUrl = apiClient.getDownloadUrl(namespace, `/transfer/progress/${result.jobId}`);
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as TransferProgress;
          setProgress(data);

          if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
            es.close();
            eventSourceRef.current = null;
            if (data.status === 'completed') {
              onComplete();
            }
          }
        } catch {
          // ignore parse errors from keep-alive comments
        }
      };

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isImporting = jobId !== null;
  const isFinished = progress?.status === 'completed' || progress?.status === 'failed' || progress?.status === 'cancelled';

  const progressPercent =
    progress?.totalFiles && progress.totalFiles > 0
      ? Math.round(((progress.completedFiles ?? 0) / progress.totalFiles) * 100)
      : undefined;

  return (
    <Modal
      isOpen
      onClose={() => {
        cleanupEventSource();
        onClose();
      }}
      aria-label="Import from HuggingFace"
      variant="medium"
    >
      <ModalHeader title="Import from HuggingFace" />
      <ModalBody>
        {!isImporting ? (
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <FormGroup label="Model ID" isRequired fieldId="hf-model-id">
              <TextInput
                id="hf-model-id"
                value={modelId}
                onChange={(_event, value) => {
                  setModelId(value);
                  setModelIdError(null);
                }}
                placeholder="meta-llama/Llama-2-7b"
                isRequired
                validated={modelIdError ? 'error' : 'default'}
              />
              {modelIdError && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem variant="error">{modelIdError}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>

            <FormGroup label="HuggingFace Token" fieldId="hf-token">
              <TextInput
                id="hf-token"
                type="password"
                value={hfToken}
                onChange={(_event, value) => setHfToken(value)}
                placeholder="Optional — required for gated models"
              />
            </FormGroup>

            <FormGroup label="Destination Prefix" fieldId="hf-prefix">
              <TextInput
                id="hf-prefix"
                value={prefix}
                onChange={(_event, value) => setPrefix(value)}
                placeholder="Optional — defaults to owner_model"
              />
            </FormGroup>

            <Content component="small">
              Files will be imported into <strong>{location.name}</strong>
              {currentPath ? ` / ${currentPath}` : ''}.
            </Content>

            {error && (
              <Alert variant="danger" title="Import failed" isInline className="pf-v6-u-mt-md">
                {error}
              </Alert>
            )}
          </Form>
        ) : (
          <>
            <Content component="p" className="pf-v6-u-mb-md">
              Importing <strong>{modelId}</strong>
              {progress?.totalFiles != null && ` (${progress.totalFiles} files)`}
            </Content>

            {progressPercent != null && (
              <Progress
                value={progressPercent}
                title="Import progress"
                measureLocation={ProgressMeasureLocation.top}
                label={`${progress?.completedFiles ?? 0} / ${progress?.totalFiles ?? 0} files`}
                variant={
                  progress?.status === 'failed'
                    ? 'danger'
                    : progress?.status === 'completed'
                      ? 'success'
                      : undefined
                }
              />
            )}

            {progress?.currentFile && (
              <Content component="small" className="pf-v6-u-mt-sm">
                Current: {progress.currentFile}
              </Content>
            )}

            {progress?.status === 'completed' && (
              <Alert variant="success" title="Import completed" isInline className="pf-v6-u-mt-md">
                All files have been imported successfully.
              </Alert>
            )}

            {progress?.status === 'failed' && (
              <Alert variant="danger" title="Import failed" isInline className="pf-v6-u-mt-md">
                {progress.error ?? 'The import encountered an error.'}
              </Alert>
            )}
          </>
        )}
      </ModalBody>
      <ModalFooter>
        {!isImporting ? (
          <>
            <Button
              variant="primary"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={isSubmitting || !modelId}
            >
              Import
            </Button>
            <Button variant="link" onClick={onClose}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant={isFinished ? 'primary' : 'link'}
            onClick={() => {
              cleanupEventSource();
              onClose();
            }}
          >
            {isFinished ? 'Close' : 'Close (Import continues in background)'}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default HuggingFaceImportModal;
