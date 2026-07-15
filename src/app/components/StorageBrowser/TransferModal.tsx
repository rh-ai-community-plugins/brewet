import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  FormGroup,
  MenuToggle,
  Select,
  SelectOption,
  SelectList,
  Alert,
  Progress,
  ProgressMeasureLocation,
  Content,
  Radio,
  Bullseye,
  Spinner,
  Label,
  List,
  ListItem,
} from '@patternfly/react-core';
import { CloudIcon, FolderIcon } from '@patternfly/react-icons';
import { storageService } from '~/app/services/storageService';
import { formatBytes } from '~/app/utils/format';
import { transferEmitter } from '~/app/utils/emitter';
import type {
  StorageLocation,
  FileInfo,
  TransferProgress,
  TransferRequest,
  ConflictCheckResult,
} from '~/app/types/storage';

type ConflictResolution = 'overwrite' | 'skip' | 'rename';
type ModalStep = 'destination' | 'conflicts' | 'progress';

interface TransferModalProps {
  namespace: string;
  sourceLocation: StorageLocation;
  currentPath: string;
  selectedFiles: FileInfo[];
  locations: StorageLocation[];
  onClose: () => void;
  onComplete: () => void;
}

function buildTransferPath(location: StorageLocation, path: string): string {
  const typeStr = location.type === 's3' ? 's3' : 'local';
  const cleanPath = path.replace(/\/$/, '');
  return cleanPath ? `${typeStr}:${location.id}/${cleanPath}` : `${typeStr}:${location.id}`;
}

const TransferModal: React.FC<TransferModalProps> = ({
  namespace,
  sourceLocation,
  currentPath,
  selectedFiles,
  locations,
  onClose,
  onComplete,
}) => {
  const [step, setStep] = useState<ModalStep>('destination');

  // Destination selection
  const [destLocationId, setDestLocationId] = useState<string | null>(null);
  const [destLocationSelectOpen, setDestLocationSelectOpen] = useState(false);

  // Conflict detection
  const [conflictResolution, setConflictResolution] = useState<ConflictResolution>('overwrite');
  const [conflictResult, setConflictResult] = useState<ConflictCheckResult | null>(null);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Transfer progress
  const [progress, setProgress] = useState<TransferProgress | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isStartingTransfer, setIsStartingTransfer] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);
  const pollIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const destLocation = useMemo(
    () => locations.find((l) => l.id === destLocationId) ?? null,
    [locations, destLocationId],
  );

  const availableDestinations = useMemo(
    () => locations.filter((l) => l.status === 'available' && l.id !== sourceLocation.id),
    [locations, sourceLocation.id],
  );

  const items = useMemo(
    () =>
      selectedFiles.map((f) => ({
        path: f.name,
        type: (f.isDirectory ? 'directory' : 'file') as 'file' | 'directory',
      })),
    [selectedFiles],
  );

  const source = useMemo(
    () => buildTransferPath(sourceLocation, currentPath),
    [sourceLocation, currentPath],
  );

  const cleanupEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
      cleanupEventSource();
    };
  }, [cleanupEventSource]);

  const buildRequest = useCallback(
    (resolution?: ConflictResolution): TransferRequest | null => {
      if (!destLocation) return null;
      return {
        source,
        destination: buildTransferPath(destLocation, ''),
        items,
        conflictResolution: resolution,
      };
    },
    [source, destLocation, items],
  );

  const startTransfer = useCallback(
    async (resolution: ConflictResolution) => {
      const request = buildRequest(resolution);
      if (!request || !destLocation) return;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsStartingTransfer(true);
      setTransferError(null);
      try {
        const result = await storageService.initiateTransfer(namespace, request, controller.signal);
        if (!mountedRef.current) return;

        setJobId(result.jobId);
        const destination = request.destination;
        transferEmitter.emit('transfer:started', { jobId: result.jobId, destination });

        const sseUrl = storageService.getTransferSseUrl(namespace, result.sseUrl);
        const es = new EventSource(sseUrl);
        eventSourceRef.current = es;

        es.addEventListener('progress', (event) => {
          try {
            const data = JSON.parse(event.data) as TransferProgress;
            if (!mountedRef.current) {
              es.close();
              return;
            }
            setProgress(data);

            if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
              es.close();
              eventSourceRef.current = null;

              if (data.status === 'completed') {
                transferEmitter.emit('transfer:completed', { jobId: result.jobId, destination });
                onComplete();
              } else if (data.status === 'cancelled') {
                storageService.cleanupTransfer(namespace, result.jobId).catch(() => undefined);
                transferEmitter.emit('transfer:cancelled', { jobId: result.jobId });
              }
            }
          } catch {
            // ignore parse errors from keep-alive comments
          }
        });

        es.onerror = () => {
          es.close();
          eventSourceRef.current = null;
          if (!mountedRef.current) return;
          setTransferError('Progress connection lost. The transfer continues in the background.');

          const schedulePoll = () => {
            const doPoll = async () => {
              try {
                const status = await storageService.getTransferProgress(namespace, result.jobId);
                if (!mountedRef.current) return;
                setProgress(status);
                if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
                  pollIntervalRef.current = null;
                  setTransferError(null);
                  if (status.status === 'completed') {
                    transferEmitter.emit('transfer:completed', { jobId: result.jobId, destination });
                    onComplete();
                  } else if (status.status === 'cancelled') {
                    storageService.cleanupTransfer(namespace, result.jobId).catch(() => undefined);
                    transferEmitter.emit('transfer:cancelled', { jobId: result.jobId });
                  }
                } else {
                  schedulePoll();
                }
              } catch {
                if (mountedRef.current) {
                  schedulePoll();
                }
              }
            };
            pollIntervalRef.current = setTimeout(doPoll, 3000);
          };
          schedulePoll();
        };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!mountedRef.current) return;
        setTransferError(err instanceof Error ? err.message : 'Failed to start transfer.');
      } finally {
        if (mountedRef.current) setIsStartingTransfer(false);
      }
    },
    [namespace, buildRequest, destLocation, onComplete],
  );

  const handleCheckConflicts = useCallback(async () => {
    const request = buildRequest();
    if (!request) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsCheckingConflicts(true);
    setConflictError(null);
    try {
      const result = await storageService.checkConflicts(namespace, request, controller.signal);
      if (!mountedRef.current) return;
      setConflictResult(result);
      if (result.conflicts.length > 0) {
        setStep('conflicts');
      } else {
        setStep('progress');
        startTransfer('overwrite');
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!mountedRef.current) return;
      setConflictError(err instanceof Error ? err.message : 'Failed to check conflicts.');
    } finally {
      if (mountedRef.current) setIsCheckingConflicts(false);
    }
  }, [namespace, buildRequest, startTransfer]);

  const handleCancel = useCallback(async () => {
    if (!jobId) return;
    setIsCancelling(true);
    try {
      await storageService.cancelTransfer(namespace, jobId);
    } catch {
      // SSE will report final status
    } finally {
      setIsCancelling(false);
    }
  }, [namespace, jobId]);

  const isFinished =
    progress?.status === 'completed' ||
    progress?.status === 'failed' ||
    progress?.status === 'cancelled';

  const progressPercent = useMemo(() => {
    if (!progress) return undefined;
    if (progress.totalBytes > 0) {
      return Math.round((progress.loadedBytes / progress.totalBytes) * 100);
    }
    if (progress.totalFiles > 0) {
      return Math.round((progress.completedFiles / progress.totalFiles) * 100);
    }
    return undefined;
  }, [progress]);

  const renderDestinationStep = () => (
    <>
      <ModalBody>
        <Content component="p" className="pf-v6-u-mb-md">
          Transfer <strong>{selectedFiles.length}</strong> item
          {selectedFiles.length !== 1 ? 's' : ''} from{' '}
          <strong>
            {sourceLocation.type === 's3' ? <CloudIcon className="pf-v6-u-mr-xs" /> : <FolderIcon className="pf-v6-u-mr-xs" />}
            {sourceLocation.name}
          </strong>
          {currentPath ? ` / ${currentPath.replace(/\/$/, '')}` : ''}
        </Content>

        <FormGroup label="Destination" isRequired fieldId="transfer-dest">
          <Select
            isOpen={destLocationSelectOpen}
            onOpenChange={setDestLocationSelectOpen}
            onSelect={(_e, value) => {
              if (typeof value === 'string') {
                setDestLocationId(value);
                setDestLocationSelectOpen(false);
              }
            }}
            selected={destLocationId}
            toggle={(toggleRef) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setDestLocationSelectOpen((prev) => !prev)}
                isExpanded={destLocationSelectOpen}
                style={{ minWidth: '250px' }}
                id="transfer-dest"
              >
                {destLocation ? (
                  <>
                    {destLocation.type === 's3' ? (
                      <CloudIcon className="pf-v6-u-mr-sm" />
                    ) : (
                      <FolderIcon className="pf-v6-u-mr-sm" />
                    )}
                    {destLocation.name}
                  </>
                ) : (
                  'Select destination...'
                )}
              </MenuToggle>
            )}
          >
            <SelectList>
              {availableDestinations.map((loc) => (
                <SelectOption key={loc.id} value={loc.id}>
                  {loc.type === 's3' ? (
                    <CloudIcon className="pf-v6-u-mr-sm" />
                  ) : (
                    <FolderIcon className="pf-v6-u-mr-sm" />
                  )}
                  {loc.name}
                  {loc.type === 's3' && <Label className="pf-v6-u-ml-sm" isCompact>S3</Label>}
                  {loc.type === 'pvc' && <Label className="pf-v6-u-ml-sm" isCompact>PVC</Label>}
                </SelectOption>
              ))}
            </SelectList>
          </Select>
        </FormGroup>

        {conflictError && (
          <Alert variant="danger" title="Conflict check failed" isInline className="pf-v6-u-mt-md">
            {conflictError}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleCheckConflicts}
          isLoading={isCheckingConflicts}
          isDisabled={!destLocation || isCheckingConflicts}
        >
          {isCheckingConflicts ? 'Checking...' : 'Next'}
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </>
  );

  const renderConflictsStep = () => (
    <>
      <ModalBody>
        {conflictResult && conflictResult.conflicts.length > 0 && (
          <>
            <Alert
              variant="warning"
              title={`${conflictResult.conflicts.length} file${conflictResult.conflicts.length !== 1 ? 's' : ''} already exist at the destination`}
              isInline
              className="pf-v6-u-mb-md"
            />

            <List isPlain className="pf-v6-u-mb-md" style={{ maxHeight: '200px', overflow: 'auto' }}>
              {conflictResult.conflicts.map((c) => (
                <ListItem key={c.path}>
                  {c.path}{' '}
                  <Content component="small">
                    (source: {formatBytes(c.sourceSize)}, dest: {formatBytes(c.destinationSize)})
                  </Content>
                </ListItem>
              ))}
            </List>

            {conflictResult.warning && (
              <Alert variant="info" title={conflictResult.warning} isInline className="pf-v6-u-mb-md" />
            )}

            <FormGroup label="How should conflicts be resolved?" fieldId="conflict-resolution">
              <Radio
                id="conflict-overwrite"
                name="conflict-resolution"
                label="Overwrite existing files"
                isChecked={conflictResolution === 'overwrite'}
                onChange={() => setConflictResolution('overwrite')}
              />
              <Radio
                id="conflict-skip"
                name="conflict-resolution"
                label="Skip conflicting files"
                isChecked={conflictResolution === 'skip'}
                onChange={() => setConflictResolution('skip')}
                className="pf-v6-u-mt-sm"
              />
              <Radio
                id="conflict-rename"
                name="conflict-resolution"
                label="Rename with suffix (e.g. file_1.txt)"
                isChecked={conflictResolution === 'rename'}
                onChange={() => setConflictResolution('rename')}
                className="pf-v6-u-mt-sm"
              />
            </FormGroup>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          onClick={() => {
            setStep('progress');
            startTransfer(conflictResolution);
          }}
          isLoading={isStartingTransfer}
          isDisabled={isStartingTransfer}
        >
          Start Transfer
        </Button>
        <Button variant="link" onClick={() => setStep('destination')}>
          Back
        </Button>
      </ModalFooter>
    </>
  );

  const renderProgressStep = () => (
    <>
      <ModalBody>
        {!progress && !transferError && (
          <Bullseye>
            <Spinner aria-label="Starting transfer" />
          </Bullseye>
        )}

        {progress && (
          <>
            <Content component="p" className="pf-v6-u-mb-md">
              Transferring files to{' '}
              <strong>{destLocation?.name}</strong>
            </Content>

            {progressPercent != null && (
              <Progress
                value={progressPercent}
                title="Transfer progress"
                measureLocation={ProgressMeasureLocation.top}
                label={`${progress.completedFiles} / ${progress.totalFiles} files (${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)})`}
                variant={
                  progress.status === 'failed'
                    ? 'danger'
                    : progress.status === 'completed'
                      ? 'success'
                      : progress.status === 'cancelled'
                        ? 'warning'
                        : undefined
                }
              />
            )}

            {progress.currentFile && !isFinished && (
              <Content component="small" className="pf-v6-u-mt-sm">
                Current: {progress.currentFile}
              </Content>
            )}

            {progress.failedFiles > 0 && (
              <Content component="small" className="pf-v6-u-mt-sm">
                {progress.failedFiles} file{progress.failedFiles !== 1 ? 's' : ''} failed
              </Content>
            )}

            {progress.status === 'completed' && (
              <Alert variant="success" title="Transfer completed" isInline className="pf-v6-u-mt-md">
                {progress.completedFiles} file{progress.completedFiles !== 1 ? 's' : ''} transferred
                successfully ({formatBytes(progress.loadedBytes)}).
              </Alert>
            )}

            {progress.status === 'failed' && (
              <Alert variant="danger" title="Transfer failed" isInline className="pf-v6-u-mt-md">
                {progress.error ?? 'The transfer encountered an error.'}
              </Alert>
            )}

            {progress.status === 'cancelled' && (
              <Alert variant="warning" title="Transfer cancelled" isInline className="pf-v6-u-mt-md">
                {progress.completedFiles} of {progress.totalFiles} files were transferred before cancellation.
              </Alert>
            )}
          </>
        )}

        {transferError && (
          <Alert variant="danger" title="Transfer error" isInline className="pf-v6-u-mt-md">
            {transferError}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        {!isFinished && !!jobId && (
          <Button
            variant="danger"
            onClick={handleCancel}
            isLoading={isCancelling}
            isDisabled={isCancelling || !jobId}
          >
            Cancel Transfer
          </Button>
        )}
        <Button
          variant={isFinished || transferError ? 'primary' : 'link'}
          onClick={() => {
            cleanupEventSource();
            onClose();
          }}
        >
          {isFinished || transferError ? 'Close' : 'Close (Transfer continues in background)'}
        </Button>
      </ModalFooter>
    </>
  );

  const titles: Record<ModalStep, string> = {
    destination: 'Transfer Files',
    conflicts: 'Resolve Conflicts',
    progress: 'Transfer Progress',
  };

  return (
    <Modal
      isOpen
      onClose={() => {
        cleanupEventSource();
        onClose();
      }}
      aria-label="Transfer files"
      variant="medium"
    >
      <ModalHeader title={titles[step]} />
      {step === 'destination' && renderDestinationStep()}
      {step === 'conflicts' && renderConflictsStep()}
      {step === 'progress' && renderProgressStep()}
    </Modal>
  );
};

export default TransferModal;
