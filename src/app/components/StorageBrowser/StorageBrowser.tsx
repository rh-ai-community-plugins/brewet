import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextInput,
  MenuToggle,
  Select,
  SelectOption,
  SelectList,
  SearchInput,
  Label,
  Bullseye,
  Spinner,
  Alert,
  AlertActionCloseButton,
  Divider,
  Content,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
} from '@patternfly/react-table';
import {
  CloudIcon,
  FolderIcon,
  FolderOpenIcon,
  FileIcon,
  DownloadIcon,
  TrashIcon,
  UploadIcon,
  SyncIcon,
  PlusCircleIcon,
  EyeIcon,
  ExternalLinkAltIcon,
} from '@patternfly/react-icons';
import { useNavigate, useParams } from 'react-router-dom';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { storageService } from '~/app/services/storageService';
import { base64Encode, base64Decode } from '~/app/utils/encoding';
import { formatBytes } from '~/app/utils/format';
import { ArrowRightIcon } from '@patternfly/react-icons';
import DocumentRenderer, { isPreviewable, getFileType } from './DocumentRenderer';
import HuggingFaceImportModal from './HuggingFaceImportModal';
import TransferModal from './TransferModal';
import { transferEmitter } from '~/app/utils/emitter';
import type { StorageLocation, FileInfo, FileListResponse } from '~/app/types/storage';
import './StorageBrowser.css';

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

interface UploadState {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

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

  // Locations
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(true);
  const [locationSelectOpen, setLocationSelectOpen] = useState(false);

  const selectedLocation = useMemo(
    () => locations.find((l) => l.id === locationId) ?? null,
    [locations, locationId],
  );

  // Files
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [continuationToken, setContinuationToken] = useState<string | undefined>();
  const [isTruncated, setIsTruncated] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localOffset, setLocalOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [pageLimit, setPageLimit] = useState(100);

  // Search
  const [searchText, setSearchText] = useState('');
  const [searchMode, setSearchMode] = useState<'startsWith' | 'contains'>('startsWith');

  // Upload
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Download
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<FileInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Preview
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);

  // Multi-select
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);

  // HuggingFace import
  const [isHfImportOpen, setIsHfImportOpen] = useState(false);

  // Transfer
  const [isTransferOpen, setIsTransferOpen] = useState(false);

  // Create folder
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeProjectRef = useRef(selectedProject);
  activeProjectRef.current = selectedProject;
  const loadFilesRef = useRef<(append?: boolean) => Promise<void>>();

  // Load locations
  useEffect(() => {
    if (!selectedProject) {
      setLocations([]);
      setLocationsLoading(false);
      return;
    }
    setLocationsLoading(true);
    storageService
      .getLocations(selectedProject)
      .then((locs) => {
        if (activeProjectRef.current === selectedProject) {
          setLocations(locs);
        }
      })
      .catch(() => {
        if (activeProjectRef.current === selectedProject) {
          setLocations([]);
        }
      })
      .finally(() => {
        if (activeProjectRef.current === selectedProject) {
          setLocationsLoading(false);
        }
      });
  }, [selectedProject]);

  // Load files when location or path changes
  const loadFiles = useCallback(
    async (append = false) => {
      if (!selectedProject || !selectedLocation) {
        setFiles([]);
        setFilesLoading(false);
        return;
      }

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const project = selectedProject;
      const location = selectedLocation;

      try {
        if (append) {
          setIsLoadingMore(true);
        } else {
          setFilesLoading(true);
          setFilesError(null);
        }

        const options: Parameters<typeof storageService.listFiles>[3] = {};
        if (location.type === 's3') {
          if (append && continuationToken) {
            options.continuationToken = continuationToken;
          }
          if (searchText.length >= 3 && searchMode === 'startsWith') {
            options.search = searchText;
            options.searchMode = 'startsWith';
          }
        } else {
          options.offset = append ? localOffset : 0;
          // Fetch the current page limit directly so the correct value is always
          // used on initial load, avoiding a race with a concurrent settings fetch.
          if (!append) {
            try {
              const fetchedLimit = await storageService.getMaxFilesPerPage(project);
              setPageLimit(fetchedLimit);
              options.limit = fetchedLimit;
            } catch {
              options.limit = pageLimit;
            }
          } else {
            options.limit = pageLimit;
          }
        }

        const response: FileListResponse = await storageService.listFiles(
          project,
          location,
          currentPath,
          options,
          controller.signal,
        );

        if (activeProjectRef.current !== project) return;

        if (append) {
          setFiles((prev) => [...prev, ...response.files]);
        } else {
          setFiles(response.files);
        }

        setContinuationToken(response.continuationToken);
        setIsTruncated(response.isTruncated ?? false);
        setTotalCount(response.totalCount);

        if (location.type === 'pvc') {
          setLocalOffset((prev) => (append ? prev : 0) + response.files.length);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (activeProjectRef.current !== project) return;
        setFilesError(err instanceof Error ? err.message : 'Failed to load files.');
      } finally {
        if (activeProjectRef.current === project) {
          setFilesLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [selectedProject, selectedLocation, currentPath, continuationToken, localOffset, searchText, searchMode, pageLimit],
  );

  loadFilesRef.current = loadFiles;

  useEffect(() => {
    isInitialSearchRef.current = true;
    setSearchText('');
    setContinuationToken(undefined);
    setLocalOffset(0);
    setIsTruncated(false);
    setTotalCount(undefined);
    setDownloadError(null);
    setSelectedFiles(new Set());
    setPreviewFile(null);
  }, [locationId, encodedPath, selectedProject]);

  useEffect(() => {
    loadFilesRef.current?.();
    return () => abortControllerRef.current?.abort();
  }, [selectedProject, selectedLocation, encodedPath]);

  // Reload on search change (debounced for server-side)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const isInitialSearchRef = useRef(true);
  useEffect(() => {
    if (isInitialSearchRef.current) {
      isInitialSearchRef.current = false;
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setContinuationToken(undefined);
      setLocalOffset(0);
      loadFilesRef.current?.();
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchText, searchMode]);

  // Refresh file listing when a transfer completes to the current location
  useEffect(() => {
    const handler = ({ destination }: { destination: string }) => {
      if (!selectedLocation) return;
      const typeStr = selectedLocation.type === 's3' ? 's3' : 'local';
      const currentDest = `${typeStr}:${selectedLocation.id}`;
      if (destination === currentDest || destination.startsWith(`${currentDest}/`)) {
        loadFilesRef.current?.();
      }
    };
    transferEmitter.on('transfer:completed', handler);
    return () => transferEmitter.off('transfer:completed', handler);
  }, [selectedLocation]);

  // Filtered files (client-side contains filter)
  const displayFiles = useMemo(() => {
    if (!searchText || (searchText.length >= 3 && searchMode === 'startsWith' && selectedLocation?.type === 's3')) {
      return files;
    }
    const lower = searchText.toLowerCase();
    if (searchMode === 'startsWith') {
      return files.filter((f) => f.name.toLowerCase().startsWith(lower));
    }
    return files.filter((f) => f.name.toLowerCase().includes(lower));
  }, [files, searchText, searchMode, selectedLocation]);

  const sortedFiles = useMemo(() => {
    const dirs = displayFiles.filter((f) => f.isDirectory);
    const regularFiles = displayFiles.filter((f) => !f.isDirectory);
    dirs.sort((a, b) => a.name.localeCompare(b.name));
    regularFiles.sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...regularFiles];
  }, [displayFiles]);

  // Navigation
  const navigateToLocation = useCallback(
    (locId: string) => {
      navigate(`/brewet/storage/browse/${encodeURIComponent(locId)}`);
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

  // Breadcrumb segments
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
    [selectedProject, selectedLocation, currentPath],
  );

  // Delete
  const handleDelete = useCallback(async () => {
    if (!selectedProject || !selectedLocation || !deleteTarget) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      const filePath = currentPath
        ? `${currentPath}${deleteTarget.name}${deleteTarget.isDirectory ? '/' : ''}`
        : `${deleteTarget.name}${deleteTarget.isDirectory ? '/' : ''}`;
      await storageService.deleteFile(selectedProject, selectedLocation, filePath);
      setDeleteTarget(null);
      loadFilesRef.current?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedProject, selectedLocation, deleteTarget, currentPath]);

  // Bulk delete
  const handleBulkDelete = useCallback(async () => {
    if (!selectedProject || !selectedLocation || selectedFiles.size === 0) return;

    setIsBulkDeleting(true);
    setBulkDeleteError(null);
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
      setBulkDeleteError(`Failed to delete ${errors.length} item(s): ${errors.join('; ')}`);
    } else {
      setIsBulkDeleteOpen(false);
      setSelectedFiles(new Set());
    }
    setIsBulkDeleting(false);
    loadFilesRef.current?.();
  }, [selectedProject, selectedLocation, selectedFiles, files, currentPath]);

  // Create folder
  const handleCreateFolder = useCallback(async () => {
    if (!selectedProject || !selectedLocation) return;

    const validationError = validateFolderName(
      newFolderName,
      selectedLocation.type,
    );
    if (validationError) {
      setCreateFolderError(validationError);
      return;
    }

    setIsCreatingFolder(true);
    setCreateFolderError(null);
    try {
      const folderPath = currentPath
        ? `${currentPath}${newFolderName}/`
        : `${newFolderName}/`;
      await storageService.createFolder(selectedProject, selectedLocation, folderPath);
      setIsCreateFolderOpen(false);
      setNewFolderName('');
      loadFilesRef.current?.();
    } catch (err) {
      setCreateFolderError(err instanceof Error ? err.message : 'Failed to create folder.');
    } finally {
      setIsCreatingFolder(false);
    }
  }, [selectedProject, selectedLocation, currentPath, newFolderName]);

  // Upload
  const processUpload = useCallback(
    async (filesToUpload: File[]) => {
      if (!selectedProject || !selectedLocation) return;

      const newUploads: UploadState[] = filesToUpload.map((f) => ({
        file: f,
        status: 'pending' as const,
      }));
      setUploads(newUploads);
      setIsUploadModalOpen(true);

      for (let i = 0; i < newUploads.length; i++) {
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, status: 'uploading' } : u)),
        );
        try {
          const filePath = currentPath
            ? `${currentPath}${newUploads[i].file.name}`
            : newUploads[i].file.name;
          await storageService.uploadFile(
            selectedProject,
            selectedLocation,
            filePath,
            newUploads[i].file,
          );
          setUploads((prev) =>
            prev.map((u, idx) =>
              idx === i ? { ...u, status: 'done' } : u,
            ),
          );
        } catch (err) {
          setUploads((prev) =>
            prev.map((u, idx) =>
              idx === i
                ? {
                    ...u,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'Upload failed',
                  }
                : u,
            ),
          );
        }
      }

      loadFilesRef.current?.();
    },
    [selectedProject, selectedLocation, currentPath],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (fileList && fileList.length > 0) {
        processUpload(Array.from(fileList));
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [processUpload],
  );

  // Drag and drop
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        processUpload(droppedFiles);
      }
    },
    [processUpload],
  );

  // Refresh
  const handleRefresh = useCallback(() => {
    if (selectedProject) {
      storageService
        .refreshLocations(selectedProject)
        .then((locs) => {
          if (activeProjectRef.current === selectedProject) {
            setLocations(locs);
          }
        })
        .catch((err: unknown) => {
          if (activeProjectRef.current === selectedProject) {
            setFilesError(
              err instanceof Error ? err.message : 'Failed to refresh storage locations.',
            );
          }
        });
    }
    setContinuationToken(undefined);
    setLocalOffset(0);
    loadFilesRef.current?.();
  }, [selectedProject]);

  // No project or no locations loading state
  if (locationsLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading storage locations" />
      </Bullseye>
    );
  }

  if (locations.length === 0) {
    return (
      <Alert variant="info" title="No storage locations found" isInline>
        No S3 buckets or PVC locations are available. Check your Data Connection and PVC
        configuration.
      </Alert>
    );
  }

  const hasMore =
    selectedLocation?.type === 's3'
      ? isTruncated
      : totalCount != null && localOffset < totalCount;

  return (
    <>
      {/* Location Selector + Breadcrumb */}
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Select
              isOpen={locationSelectOpen}
              onOpenChange={setLocationSelectOpen}
              onSelect={(_e, value) => {
                if (typeof value === 'string') {
                  navigateToLocation(value);
                  setLocationSelectOpen(false);
                }
              }}
              selected={locationId}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setLocationSelectOpen((prev) => !prev)}
                  isExpanded={locationSelectOpen}
                  style={{ minWidth: '200px' }}
                >
                  {selectedLocation ? (
                    <>
                      {selectedLocation.type === 's3' ? (
                        <CloudIcon className="pf-v6-u-mr-sm" />
                      ) : (
                        <FolderIcon className="pf-v6-u-mr-sm" />
                      )}
                      {selectedLocation.name}
                    </>
                  ) : (
                    'Select location...'
                  )}
                </MenuToggle>
              )}
            >
              <SelectList>
                {locations.map((loc) => (
                  <SelectOption key={loc.id} value={loc.id} isDisabled={loc.status !== 'available'}>
                    {loc.type === 's3' ? (
                      <CloudIcon className="pf-v6-u-mr-sm" />
                    ) : (
                      <FolderIcon className="pf-v6-u-mr-sm" />
                    )}
                    {loc.name}
                    {loc.status !== 'available' && (
                      <Label color="red" className="pf-v6-u-ml-sm" isCompact>
                        {loc.status}
                      </Label>
                    )}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>

      {/* Breadcrumb */}
      {selectedLocation && (
        <Breadcrumb className="pf-v6-u-mb-md">
          <BreadcrumbItem
            onClick={() => navigateToPath('')}
            component="button"
          >
            {selectedLocation.name}
          </BreadcrumbItem>
          {pathSegments.map((seg, idx) => (
            <BreadcrumbItem
              key={seg.path}
              isActive={idx === pathSegments.length - 1}
              onClick={
                idx < pathSegments.length - 1
                  ? () => navigateToPath(seg.path)
                  : undefined
              }
              component={idx < pathSegments.length - 1 ? 'button' : undefined}
            >
              {seg.label}
            </BreadcrumbItem>
          ))}
        </Breadcrumb>
      )}

      {/* Actions toolbar */}
      {selectedLocation && (
        <Toolbar>
          <ToolbarContent>
            <ToolbarGroup>
              <ToolbarItem>
                <SearchInput
                  placeholder="Search files..."
                  value={searchText}
                  onChange={(_event, value) => setSearchText(value)}
                  onClear={() => setSearchText('')}
                />
              </ToolbarItem>
              <ToolbarItem>
                <ToggleGroup aria-label="Search mode">
                  <ToggleGroupItem
                    text="Prefix"
                    buttonId="search-prefix"
                    isSelected={searchMode === 'startsWith'}
                    onChange={() => setSearchMode('startsWith')}
                  />
                  <ToggleGroupItem
                    text="Contains"
                    buttonId="search-contains"
                    isSelected={searchMode === 'contains'}
                    onChange={() => setSearchMode('contains')}
                  />
                </ToggleGroup>
              </ToolbarItem>
            </ToolbarGroup>
            <ToolbarGroup align={{ default: 'alignEnd' }}>
              <ToolbarItem>
                <Button
                  variant="primary"
                  icon={<UploadIcon />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  icon={<PlusCircleIcon />}
                  onClick={() => {
                    setNewFolderName('');
                    setCreateFolderError(null);
                    setIsCreateFolderOpen(true);
                  }}
                >
                  Create Folder
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="secondary"
                  icon={<ExternalLinkAltIcon />}
                  onClick={() => setIsHfImportOpen(true)}
                >
                  Import from HuggingFace
                </Button>
              </ToolbarItem>
              <ToolbarItem>
                <Button
                  variant="plain"
                  icon={<SyncIcon />}
                  onClick={handleRefresh}
                  aria-label="Refresh"
                />
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
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
                variant="secondary"
                isDanger
                icon={<TrashIcon />}
                onClick={() => {
                  setBulkDeleteError(null);
                  setIsBulkDeleteOpen(true);
                }}
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

      {/* Contains search warning: only loaded pages are filtered */}
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
        <div
          className={`storage-browser__dropzone${isDragOver ? ' storage-browser__dropzone--active' : ''}`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {isDragOver && (
            <div className="storage-browser__drop-message">Drop files here to upload</div>
          )}

          <Table aria-label="File listing" variant="compact">
            <Thead>
              <Tr>
                <Th
                  select={{
                    onSelect: (_event, isSelected) => {
                      if (isSelected) {
                        setSelectedFiles(new Set(sortedFiles.map((f) => f.name)));
                      } else {
                        setSelectedFiles(new Set());
                      }
                    },
                    isSelected: sortedFiles.length > 0 && selectedFiles.size === sortedFiles.length,
                  }}
                />
                <Th width={35}>Name</Th>
                <Th width={20}>Last Modified</Th>
                <Th width={15}>Size</Th>
                <Th width={20}>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sortedFiles.length === 0 ? (
                <Tr>
                  <Td colSpan={5}>
                    <Bullseye>
                      {searchText
                        ? 'No files match your search.'
                        : 'This folder is empty.'}
                    </Bullseye>
                  </Td>
                </Tr>
              ) : (
                sortedFiles.map((file, rowIndex) => {
                  const fileType = file.isDirectory ? undefined : getFileType(file.name);
                  const canPreview = fileType != null && isPreviewable(fileType);
                  return (
                  <Tr
                    key={file.name}
                    isClickable={file.isDirectory || canPreview}
                    onRowClick={
                      file.isDirectory
                        ? () => handleFileClick(file)
                        : canPreview
                          ? () => setPreviewFile(file)
                          : undefined
                    }
                  >
                    <Td
                      select={{
                        rowIndex,
                        onSelect: (_event, isSelected) => {
                          _event.stopPropagation();
                          setSelectedFiles((prev) => {
                            const next = new Set(prev);
                            if (isSelected) {
                              next.add(file.name);
                            } else {
                              next.delete(file.name);
                            }
                            return next;
                          });
                        },
                        isSelected: selectedFiles.has(file.name),
                      }}
                    />
                    <Td dataLabel="Name">
                      {file.isDirectory ? (
                        <FolderOpenIcon className="pf-v6-u-mr-sm" color="var(--pf-t--global--color--status--info--default, #0066cc)" />
                      ) : (
                        <FileIcon className="pf-v6-u-mr-sm" />
                      )}
                      {file.name}
                    </Td>
                    <Td dataLabel="Last Modified">
                      {file.lastModified
                        ? new Date(file.lastModified).toLocaleString()
                        : '—'}
                    </Td>
                    <Td dataLabel="Size">
                      {file.isDirectory ? '—' : formatBytes(file.size)}
                    </Td>
                    <Td dataLabel="Actions" isActionCell>
                      {canPreview && (
                        <Button
                          variant="plain"
                          icon={<EyeIcon />}
                          aria-label={`Preview ${file.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewFile(file);
                          }}
                        />
                      )}
                      {!file.isDirectory && (
                        <Button
                          variant="plain"
                          icon={<DownloadIcon />}
                          aria-label={`Download ${file.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                        />
                      )}
                      <Button
                        variant="plain"
                        icon={<TrashIcon />}
                        aria-label={`Delete ${file.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteError(null);
                          setDeleteTarget(file);
                        }}
                      />
                    </Td>
                  </Tr>
                  );
                })
              )}
            </Tbody>
          </Table>

          {/* Load More / Pagination */}
          {hasMore && (
            <Bullseye className="pf-v6-u-mt-md pf-v6-u-mb-md">
              <Button
                variant="secondary"
                onClick={() => loadFilesRef.current?.(true)}
                isLoading={isLoadingMore}
                isDisabled={isLoadingMore}
              >
                Load More
              </Button>
            </Bullseye>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <Modal
          isOpen
          onClose={() => setDeleteTarget(null)}
          aria-label={`Delete ${deleteTarget.name}`}
          variant="small"
        >
          <ModalHeader
            title={`Delete ${deleteTarget.isDirectory ? 'Folder' : 'File'}`}
          />
          <ModalBody>
            {deleteTarget.isDirectory && (
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
            <Content>
              Are you sure you want to delete{' '}
              <strong>{deleteTarget.name}</strong>?
            </Content>
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
              isDisabled={isDeleting}
            >
              Delete
            </Button>
            <Button variant="link" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* Create folder modal */}
      <Modal
        isOpen={isCreateFolderOpen}
        onClose={() => setIsCreateFolderOpen(false)}
        aria-label="Create folder"
        variant="small"
      >
        <ModalHeader title="Create Folder" />
        <ModalBody>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateFolder();
            }}
          >
            <FormGroup label="Folder name" isRequired fieldId="folder-name">
              <TextInput
                id="folder-name"
                value={newFolderName}
                onChange={(_event, value) => {
                  setNewFolderName(value);
                  setCreateFolderError(null);
                }}
                isRequired
                validated={createFolderError ? 'error' : 'default'}
              />
              {createFolderError && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem variant="error">{createFolderError}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={handleCreateFolder}
            isLoading={isCreatingFolder}
            isDisabled={isCreatingFolder || !newFolderName}
          >
            Create
          </Button>
          <Button variant="link" onClick={() => setIsCreateFolderOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      {/* Bulk delete confirmation modal */}
      {isBulkDeleteOpen && (
        <Modal
          isOpen
          onClose={() => setIsBulkDeleteOpen(false)}
          aria-label="Bulk delete confirmation"
          variant="small"
        >
          <ModalHeader title="Delete Selected Items" />
          <ModalBody>
            {sortedFiles.some((f) => f.isDirectory && selectedFiles.has(f.name)) && (
              <Alert
                variant="warning"
                title="Recursive deletion"
                isInline
                isPlain
                className="pf-v6-u-mb-md"
              >
                Selected folders and all their contents will be permanently deleted.
              </Alert>
            )}
            <Content>
              Are you sure you want to delete <strong>{selectedFiles.size}</strong> selected
              item{selectedFiles.size !== 1 ? 's' : ''}? This action cannot be undone.
            </Content>
            {bulkDeleteError && (
              <Alert variant="danger" title="Some deletions failed" isInline className="pf-v6-u-mt-md">
                {bulkDeleteError}
              </Alert>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="danger"
              onClick={handleBulkDelete}
              isLoading={isBulkDeleting}
              isDisabled={isBulkDeleting}
            >
              Delete {selectedFiles.size} Item{selectedFiles.size !== 1 ? 's' : ''}
            </Button>
            <Button variant="link" onClick={() => setIsBulkDeleteOpen(false)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}

      {/* File preview modal */}
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

      {/* Upload progress modal */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={() => {
          if (uploads.every((u) => u.status === 'done' || u.status === 'error')) {
            setIsUploadModalOpen(false);
            setUploads([]);
          }
        }}
        aria-label="Upload progress"
        variant="medium"
      >
        <ModalHeader title="Uploading Files" />
        <ModalBody>
          <div className="storage-browser__upload-list">
            {uploads.map((upload, idx) => (
              <div key={idx} className="pf-v6-u-mb-sm">
                <Content component="p" className="pf-v6-u-mb-xs">
                  <FileIcon className="pf-v6-u-mr-sm" />
                  {upload.file.name}
                  <span className="pf-v6-u-ml-sm">
                    ({formatBytes(upload.file.size)})
                  </span>
                </Content>
                {upload.status === 'uploading' && (
                  <Spinner size="sm" aria-label={`Uploading ${upload.file.name}`} />
                )}
                {upload.status === 'done' && (
                  <Label color="green" isCompact>
                    Uploaded
                  </Label>
                )}
                {upload.status === 'error' && (
                  <Label color="red" isCompact>
                    {upload.error ?? 'Failed'}
                  </Label>
                )}
                {upload.status === 'pending' && (
                  <Label color="grey" isCompact>
                    Pending
                  </Label>
                )}
                {idx < uploads.length - 1 && <Divider className="pf-v6-u-mt-sm" />}
              </div>
            ))}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={() => {
              setIsUploadModalOpen(false);
              setUploads([]);
            }}
            isDisabled={uploads.some((u) => u.status === 'uploading' || u.status === 'pending')}
          >
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* HuggingFace import modal */}
      {isHfImportOpen && selectedLocation && selectedProject && (
        <HuggingFaceImportModal
          namespace={selectedProject}
          location={selectedLocation}
          currentPath={currentPath}
          onClose={() => setIsHfImportOpen(false)}
          onComplete={() => {
            setIsHfImportOpen(false);
            loadFilesRef.current?.();
          }}
        />
      )}

      {/* Transfer modal */}
      {isTransferOpen && selectedLocation && selectedProject && (
        <TransferModal
          namespace={selectedProject}
          sourceLocation={selectedLocation}
          currentPath={currentPath}
          selectedFiles={files.filter((f) => selectedFiles.has(f.name))}
          locations={locations}
          onClose={() => setIsTransferOpen(false)}
          onComplete={() => {
            setIsTransferOpen(false);
            setSelectedFiles(new Set());
          }}
        />
      )}
    </>
  );
};

export default StorageBrowser;
