import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Button,
  Bullseye,
  Spinner,
  Alert,
  AlertActionCloseButton,
  Content,
} from '@patternfly/react-core';
import {
  ArrowRightIcon,
  TrashIcon,
} from '@patternfly/react-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { storageService } from '~/app/services/storageService';
import { base64Encode, base64Decode } from '~/app/utils/encoding';
import DocumentRenderer from './DocumentRenderer';
import HuggingFaceImportModal from './HuggingFaceImportModal';
import TransferModal from './TransferModal';
import DeleteConfirmationModal from './DeleteConfirmationModal';
import CreateFolderModal from './CreateFolderModal';
import BulkDeleteConfirmationModal from './BulkDeleteConfirmationModal';
import UploadModal from './UploadModal';
import FileTable from './FileTable';
import LocationToolbar from './LocationToolbar';
import StorageBrowserToolbar from './StorageBrowserToolbar';
import { useStorageLocations, LOCATION_STORAGE_KEY } from './useStorageLocations';
import { useFileList } from './useFileList';
import type { FileInfo } from '~/app/types/storage';
import './StorageBrowser.css';

const StorageBrowser: React.FC = () => {
  const { selectedProject } = useBrewetContext();
  const navigate = useNavigate();
  const { locationId, path: encodedPath } = useParams<{ locationId?: string; path?: string }>();

  const currentPath = useMemo(() => {
    if (!encodedPath) return '';
    try {
      return base64Decode(encodedPath);
    } catch {
      return '';
    }
  }, [encodedPath]);

  const {
    locations,
    s3Connected,
    locationsLoading,
    refreshLocations,
  } = useStorageLocations({ selectedProject, locationId });

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId) ?? null,
    [locations, locationId],
  );

  const {
    files,
    sortedFiles,
    filesLoading,
    filesError,
    setFilesError,
    searchText,
    setSearchText,
    searchMode,
    setSearchMode,
    hasMore,
    isLoadingMore,
    continuationToken,
    isTruncated,
    reloadFiles,
    loadMoreFiles,
    selectedFiles,
    setSelectedFiles,
    previewFile,
    setPreviewFile,
    downloadError,
    setDownloadError,
  } = useFileList({
    selectedProject,
    selectedLocation,
    currentPath,
    locationId,
    encodedPath,
  });

  // Modal open state
  const [deleteTarget, setDeleteTarget] = useState<FileInfo | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isHfImportOpen, setIsHfImportOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  // Refs for focus management after modal close
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const bulkDeleteButtonRef = useRef<HTMLButtonElement>(null);
  const createFolderButtonRef = useRef<HTMLButtonElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);

  const selectedFileInfos = useMemo(
    () => files.filter((f) => selectedFiles.has(f.name)),
    [files, selectedFiles],
  );

  // Navigation
  const navigateToLocation = useCallback(
    (locId: string) => {
      navigate(`/brewet/storage/browse/${encodeURIComponent(locId)}`);
      try { localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ locationId: locId })); } catch { /* unavailable */ }
    },
    [navigate],
  );

  const navigateToPath = useCallback(
    (path: string) => {
      if (!locationId) return;
      if (!path) {
        navigate(`/brewet/storage/browse/${encodeURIComponent(locationId)}`);
      } else {
        navigate(
          `/brewet/storage/browse/${encodeURIComponent(locationId)}/${base64Encode(path)}`,
        );
      }
      try { localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ locationId, path: path || undefined })); } catch { /* unavailable */ }
    },
    [navigate, locationId],
  );

  const handleFileClick = useCallback(
    (file: FileInfo) => {
      if (file.isDirectory) {
        const newPath = currentPath ? `${currentPath}${file.name}/` : `${file.name}/`;
        navigateToPath(newPath);
      }
    },
    [currentPath, navigateToPath],
  );

  const pathSegments = useMemo(() => {
    if (!currentPath) return [];
    return currentPath
      .split('/')
      .filter(Boolean)
      .map((segment, index, arr) => ({
        label: segment,
        path: arr.slice(0, index + 1).join('/') + '/',
      }));
  }, [currentPath]);

  // Download
  const handleDownload = useCallback(
    async (file: FileInfo) => {
      if (!selectedProject || !selectedLocation) return;
      setDownloadError(null);
      try {
        const filePath = currentPath ? `${currentPath}${file.name}` : file.name;
        const url = await storageService.downloadFile(selectedProject, selectedLocation, filePath);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : 'Failed to download file.');
      }
    },
    [selectedProject, selectedLocation, currentPath, setDownloadError],
  );

  // Delete
  const handleDelete = useCallback(async () => {
    if (!selectedProject || !selectedLocation || !deleteTarget) return;

    const filePath = currentPath
      ? `${currentPath}${deleteTarget.name}${deleteTarget.isDirectory ? '/' : ''}`
      : `${deleteTarget.name}${deleteTarget.isDirectory ? '/' : ''}`;
    await storageService.deleteFile(selectedProject, selectedLocation, filePath);
    setDeleteTarget(null);
    reloadFiles();
    requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  }, [selectedProject, selectedLocation, deleteTarget, currentPath, reloadFiles]);

  // Bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (!selectedProject || !selectedLocation || selectedFiles.size === 0) return;

    const errors: string[] = [];
    const fileMap = new Map(files.map((f) => [f.name, f]));
    for (const fileName of selectedFiles) {
      const file = fileMap.get(fileName);
      if (!file) continue;
      try {
        const filePath = currentPath
          ? `${currentPath}${file.name}${file.isDirectory ? '/' : ''}`
          : `${file.name}${file.isDirectory ? '/' : ''}`;
        await storageService.deleteFile(selectedProject, selectedLocation, filePath);
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Failed'}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Failed to delete ${errors.length} item(s): ${errors.join('; ')}`);
    }
    setIsBulkDeleteOpen(false);
    setSelectedFiles(new Set());
    requestAnimationFrame(() => bulkDeleteButtonRef.current?.focus());
    reloadFiles();
  }, [selectedProject, selectedLocation, selectedFiles, files, currentPath, setSelectedFiles, reloadFiles]);

  // Create folder
  const handleCreateFolder = useCallback(async (folderName: string) => {
    if (!selectedProject || !selectedLocation) return;

    const folderPath = currentPath
      ? `${currentPath}${folderName}/`
      : `${folderName}/`;
    await storageService.createFolder(selectedProject, selectedLocation, folderPath);
    setIsCreateFolderOpen(false);
    reloadFiles();
    requestAnimationFrame(() => createFolderButtonRef.current?.focus());
  }, [selectedProject, selectedLocation, currentPath, reloadFiles]);

  // Refresh
  const handleRefresh = useCallback(() => {
    refreshLocations().catch((err: unknown) => {
      setFilesError(
        err instanceof Error ? err.message : 'Failed to refresh storage locations.',
      );
    });
    reloadFiles();
  }, [refreshLocations, reloadFiles, setFilesError]);

  if (locationsLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading storage locations" />
      </Bullseye>
    );
  }

  if (locations.length === 0) {
    return (
      <Alert
        variant="info"
        title={s3Connected ? 'S3 connected — no buckets yet' : 'No storage locations found'}
        isInline
        actionLinks={
          <>
            {s3Connected && (
              <Button variant="link" isInline onClick={() => navigate('/brewet/storage/manage')}>
                Go to Storage Management
              </Button>
            )}
            <Button variant="link" isInline onClick={handleRefresh}>
              Refresh
            </Button>
          </>
        }
      >
        {s3Connected
          ? 'Your S3 connection is active but no buckets exist yet. Create a bucket in Storage Management to get started.'
          : 'No S3 buckets or PVC locations are available. Check your Data Connection and PVC configuration.'}
      </Alert>
    );
  }

  return (
    <>
      <LocationToolbar
        locations={locations}
        selectedLocation={selectedLocation}
        locationId={locationId}
        pathSegments={pathSegments}
        currentPath={currentPath}
        onSelectLocation={navigateToLocation}
        onNavigateToPath={navigateToPath}
      />

      {selectedLocation && (
        <StorageBrowserToolbar
          searchText={searchText}
          onSearchChange={setSearchText}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          onUploadClick={() => setIsUploadModalOpen(true)}
          onCreateFolderClick={() => setIsCreateFolderOpen(true)}
          onImportClick={() => setIsHfImportOpen(true)}
          onRefreshClick={handleRefresh}
          uploadButtonRef={uploadButtonRef}
          createFolderButtonRef={createFolderButtonRef}
        />
      )}

      {/* Bulk action toolbar */}
      {selectedFiles.size > 0 && (
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <Content component="small">
                {selectedFiles.size} item{selectedFiles.size !== 1 ? 's' : ''} selected
              </Content>
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="secondary"
                icon={<ArrowRightIcon />}
                onClick={() => setIsTransferOpen(true)}
              >
                Transfer to...
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Button
                ref={bulkDeleteButtonRef}
                variant="secondary"
                isDanger
                icon={<TrashIcon />}
                onClick={() => setIsBulkDeleteOpen(true)}
              >
                Delete Selected
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant="link"
                onClick={() => setSelectedFiles(new Set())}
              >
                Clear Selection
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      )}

      {/* Download error */}
      {downloadError && (
        <Alert
          variant="danger"
          title="Download failed"
          isInline
          className="pf-v6-u-mt-md"
          actionClose={<AlertActionCloseButton onClose={() => setDownloadError(null)} />}
        >
          {downloadError}
        </Alert>
      )}

      {/* Contains search warning */}
      {searchText && searchMode === 'contains' && selectedLocation?.type === 's3' && (continuationToken || isTruncated) && (
        <Alert
          variant="info"
          title="Search covers loaded files only"
          isInline
          className="pf-v6-u-mt-md"
        >
          "Contains" search filters only the files loaded so far. There are more pages
          in this bucket that have not been searched. Load more files or switch to{' '}
          <strong>Prefix</strong> search for complete server-side results.
        </Alert>
      )}

      {/* File listing */}
      {!selectedLocation ? (
        <Content component="p" className="pf-v6-u-mt-md">
          Select a storage location to browse files.
        </Content>
      ) : filesLoading ? (
        <Bullseye className="pf-v6-u-mt-xl">
          <Spinner aria-label="Loading files" />
        </Bullseye>
      ) : filesError ? (
        <Alert variant="danger" title="Error loading files" isInline className="pf-v6-u-mt-md">
          {filesError}
        </Alert>
      ) : (
        <FileTable
          files={sortedFiles}
          selectedFiles={selectedFiles}
          onSelectFiles={setSelectedFiles}
          onFileClick={handleFileClick}
          onPreview={(file) => setPreviewFile(file)}
          onDownload={handleDownload}
          onDelete={(file, triggerElement) => {
            deleteTriggerRef.current = triggerElement;
            setDeleteTarget(file);
          }}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          onLoadMore={loadMoreFiles}
          searchText={searchText}
        />
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteConfirmationModal
          target={deleteTarget}
          onConfirm={handleDelete}
          onClose={() => {
            setDeleteTarget(null);
            requestAnimationFrame(() => deleteTriggerRef.current?.focus());
          }}
        />
      )}

      {/* Create folder modal */}
      <CreateFolderModal
        isOpen={isCreateFolderOpen}
        storageType={selectedLocation?.type ?? 's3'}
        onConfirm={handleCreateFolder}
        onClose={() => {
          setIsCreateFolderOpen(false);
          requestAnimationFrame(() => createFolderButtonRef.current?.focus());
        }}
      />

      {/* Bulk delete confirmation modal */}
      {isBulkDeleteOpen && (
        <BulkDeleteConfirmationModal
          selectedFiles={selectedFiles}
          sortedFiles={sortedFiles}
          onConfirm={handleBulkDelete}
          onClose={() => {
            setIsBulkDeleteOpen(false);
            requestAnimationFrame(() => bulkDeleteButtonRef.current?.focus());
          }}
        />
      )}

      {/* File preview */}
      {previewFile && selectedLocation && selectedProject && (
        <DocumentRenderer
          file={previewFile}
          namespace={selectedProject}
          location={selectedLocation}
          currentPath={currentPath}
          onClose={() => setPreviewFile(null)}
          onDownload={(file) => {
            setPreviewFile(null);
            handleDownload(file);
          }}
        />
      )}

      {/* Upload modal */}
      {isUploadModalOpen && selectedLocation && selectedProject && (
        <UploadModal
          isOpen={isUploadModalOpen}
          namespace={selectedProject}
          location={selectedLocation}
          currentPath={currentPath}
          onClose={() => setIsUploadModalOpen(false)}
          onComplete={reloadFiles}
        />
      )}

      {/* HuggingFace import modal */}
      {isHfImportOpen && selectedLocation && selectedProject && (
        <HuggingFaceImportModal
          namespace={selectedProject}
          location={selectedLocation}
          currentPath={currentPath}
          onClose={() => setIsHfImportOpen(false)}
          onComplete={() => {
            setIsHfImportOpen(false);
            reloadFiles();
          }}
        />
      )}

      {/* Transfer modal */}
      {isTransferOpen && selectedLocation && selectedProject && (
        <TransferModal
          namespace={selectedProject}
          sourceLocation={selectedLocation}
          currentPath={currentPath}
          selectedFiles={selectedFileInfos}
          locations={locations}
          onClose={() => setIsTransferOpen(false)}
          onComplete={() => {
            setIsTransferOpen(false);
            setSelectedFiles(new Set());
            reloadFiles();
          }}
        />
      )}
    </>
  );
};

export default StorageBrowser;
