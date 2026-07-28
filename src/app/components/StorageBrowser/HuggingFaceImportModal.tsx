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
  InputGroup,
  InputGroupItem,
} from '@patternfly/react-core';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  InProgressIcon,
  PendingIcon,
} from '@patternfly/react-icons';
import { storageService } from '~/app/services/storageService';
import { apiClient } from '~/app/services/apiClient';
import { formatBytes } from '~/app/utils/format';
import type { StorageLocation, TransferProgress, TransferFileJob } from '~/app/types/storage';

const MODEL_ID_REGEX = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/;

const FILE_STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <PendingIcon color="var(--pf-t--global--icon--color--subtle)" />,
  active: <InProgressIcon color="var(--pf-t--global--icon--color--brand--default)" />,
  completed: <CheckCircleIcon color="var(--pf-t--global--color--status--success--default)" />,
  failed: <ExclamationCircleIcon color="var(--pf-t--global--color--status--danger--default)" />,
  cancelled: <ExclamationCircleIcon color="var(--pf-t--global--icon--color--subtle)" />,
};

function filePercent(loaded: number, size: number): number | undefined {
  if (!size || size <= 0) return undefined;
  return Math.min(100, Math.round((loaded / size) * 100));
}

const DL_BAR_COLOR = 'var(--pf-t--global--color--brand--default)';
const UL_BAR_COLOR = 'var(--pf-t--global--color--status--success--default)';

const FileProgressRow: React.FC<{ file: TransferFileJob; isS3: boolean }> = ({ file, isS3 }) => {
  const fileName = file.sourcePath.split('/').pop() || file.sourcePath;
  const dlPercent = filePercent(file.loaded, file.size);
  const ulPercent = isS3 ? filePercent(file.uploadLoaded ?? 0, file.size) : undefined;
  const showBars = file.status === 'active' || file.status === 'completed' || file.status === 'failed';

  return (
    <div style={{ padding: '4px 0', borderBottom: '1px solid var(--pf-t--global--border--color--default)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: showBars ? '4px' : 0 }}>
        <span style={{ flexShrink: 0, display: 'inline-flex' }}>{FILE_STATUS_ICON[file.status] ?? null}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--pf-t--global--font--size--xs)' }}>
          {fileName}
        </span>
        {file.size > 0 && (
          <span style={{ flexShrink: 0, fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--text--color--subtle)' }}>
            {formatBytes(file.size)}
          </span>
        )}
      </div>
      {showBars && dlPercent != null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div
            style={{ height: '6px', borderRadius: '3px', backgroundColor: 'var(--pf-t--global--background--color--secondary--default)', overflow: 'hidden' }}
            role="progressbar"
            aria-label={`${fileName} downloaded`}
            aria-valuenow={dlPercent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div style={{ height: '100%', width: `${dlPercent}%`, backgroundColor: DL_BAR_COLOR, borderRadius: '3px', transition: 'width 0.3s' }} />
          </div>
          {ulPercent != null && (
            <div
              style={{ height: '6px', borderRadius: '3px', backgroundColor: 'var(--pf-t--global--background--color--secondary--default)', overflow: 'hidden' }}
              role="progressbar"
              aria-label={`${fileName} uploaded`}
              aria-valuenow={ulPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ height: '100%', width: `${ulPercent}%`, backgroundColor: UL_BAR_COLOR, borderRadius: '3px', transition: 'width 0.3s' }} />
            </div>
          )}
        </div>
      )}
      {file.status === 'failed' && file.error && (
        <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--color--status--danger--default)' }}>
          {file.error}
        </span>
      )}
    </div>
  );
};

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
  const [showToken, setShowToken] = useState(false);
  const [excludeExtensions, setExcludeExtensions] = useState('');
  const [modelIdError, setModelIdError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);

  const cleanupEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    storageService.getHuggingFaceSettings(namespace, controller.signal)
      .then((settings) => {
        if (mountedRef.current && settings.hfToken) {
          setHfToken(settings.hfToken);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [namespace]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      cleanupEventSource();
    };
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
      const effectivePrefix = modelId.replace('/', '_');
      const fullPrefix = currentPath
        ? `${currentPath.replace(/\/+$/, '')}/${effectivePrefix}`
        : effectivePrefix;

      const parsedExclude = excludeExtensions
        .split(',')
        .map((ext) => ext.trim())
        .filter(Boolean)
        .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));

      const result = await storageService.importHuggingFace(namespace, {
        modelId,
        destinationType: location.type === 's3' ? 's3' : 'local',
        bucketName: location.type === 's3' ? location.id : undefined,
        localLocationId: location.type === 'pvc' ? location.id : undefined,
        localPath: currentPath || undefined,
        hfToken: hfToken || undefined,
        prefix: fullPrefix,
        excludeExtensions: parsedExclude.length > 0 ? parsedExclude : undefined,
      });

      setJobId(result.jobId);
      setProgress({
        type: 'huggingface',
        jobId: result.jobId,
        status: 'queued',
        totalFiles: result.fileCount,
        completedFiles: 0,
        failedFiles: 0,
        cancelledFiles: 0,
        totalBytes: 0,
        loadedBytes: 0,
        files: [],
      });

      const ssePath = result.sseUrl.replace(/^\/api/, '');
      const sseUrl = apiClient.getDownloadUrl(namespace, ssePath);
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      es.addEventListener('progress', (event) => {
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
      });

      es.onerror = () => {
        es.close();
        eventSourceRef.current = null;
        setError('Progress connection lost. The import continues in the background.');
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start import.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    setIsCancelling(true);
    try {
      await storageService.cancelTransfer(namespace, jobId);
    } catch {
      // SSE will report final status
    } finally {
      if (mountedRef.current) setIsCancelling(false);
    }
  }, [namespace, jobId]);

  const handleDeleteCancelledFiles = useCallback(async () => {
    if (!jobId) return;
    setIsCleaning(true);
    try {
      await storageService.cleanupTransfer(namespace, jobId);
    } catch {
      // best effort
    } finally {
      if (mountedRef.current) setIsCleaning(false);
    }
    onClose();
  }, [namespace, jobId, onClose]);

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
              <InputGroup>
                <InputGroupItem isFill>
                  <TextInput
                    id="hf-token"
                    type={showToken ? 'text' : 'password'}
                    value={hfToken}
                    onChange={(_event, value) => setHfToken(value)}
                    placeholder="Optional — required for gated models"
                  />
                </InputGroupItem>
                <InputGroupItem>
                  <Button
                    variant="control"
                    onClick={() => setShowToken(!showToken)}
                    aria-label={showToken ? 'Hide token' : 'Show token'}
                  >
                    {showToken ? <EyeSlashIcon /> : <EyeIcon />}
                  </Button>
                </InputGroupItem>
              </InputGroup>
            </FormGroup>

            <FormGroup label="Exclude file extensions" fieldId="hf-exclude-extensions">
              <TextInput
                id="hf-exclude-extensions"
                value={excludeExtensions}
                onChange={(_event, value) => setExcludeExtensions(value)}
                placeholder=".onnx, .bin, .safetensors"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>Files with these extensions will not be downloaded.</HelperTextItem>
                </HelperText>
              </FormHelperText>
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
          <div aria-live="polite">
            <Content component="p" className="pf-v6-u-mb-md">
              Importing <strong>{modelId}</strong>
              {progress?.totalFiles != null && ` (${progress.totalFiles} files)`}
            </Content>

            {progressPercent != null && (
              <Progress
                value={progressPercent}
                title="Overall progress"
                measureLocation={ProgressMeasureLocation.top}
                label={`${progress?.completedFiles ?? 0} / ${progress?.totalFiles ?? 0} files`}
                variant={
                  progress?.status === 'failed'
                    ? 'danger'
                    : progress?.status === 'completed'
                      ? 'success'
                      : progress?.status === 'cancelled'
                        ? 'warning'
                        : undefined
                }
              />
            )}

            {progress?.files && progress.files.length > 0 && (
              <div className="pf-v6-u-mt-md">
                <div style={{ display: 'flex', gap: '12px', marginBottom: '6px', fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--text--color--subtle)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ display: 'inline-block', width: '12px', height: '6px', borderRadius: '3px', backgroundColor: DL_BAR_COLOR }} />
                    Downloaded
                  </span>
                  {location.type === 's3' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ display: 'inline-block', width: '12px', height: '6px', borderRadius: '3px', backgroundColor: UL_BAR_COLOR }} />
                      Uploaded to S3
                    </span>
                  )}
                </div>
                <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {progress.files.map((file) => (
                  <FileProgressRow
                    key={file.sourcePath}
                    file={file}
                    isS3={location.type === 's3'}
                  />
                ))}
                </div>
              </div>
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

            {progress?.status === 'cancelled' && (
              <Alert variant="warning" title="Import cancelled" isInline className="pf-v6-u-mt-md">
                {progress.completedFiles} of {progress.totalFiles} files have already been downloaded. You can keep or delete them.
              </Alert>
            )}
          </div>
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
        ) : progress?.status === 'cancelled' ? (
          <>
            <Button
              variant="primary"
              onClick={() => {
                cleanupEventSource();
                onComplete();
              }}
            >
              Keep Files
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteCancelledFiles}
              isLoading={isCleaning}
              isDisabled={isCleaning}
            >
              Delete Files
            </Button>
          </>
        ) : (
          <>
            {!isFinished && !!jobId && (
              <Button
                variant="danger"
                onClick={handleCancel}
                isLoading={isCancelling}
                isDisabled={isCancelling}
              >
                Cancel Import
              </Button>
            )}
            <Button
              variant={isFinished ? 'primary' : 'link'}
              onClick={() => {
                cleanupEventSource();
                onClose();
              }}
            >
              {isFinished ? 'Close' : 'Close (Import continues in background)'}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default HuggingFaceImportModal;
