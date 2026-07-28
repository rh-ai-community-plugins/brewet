import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageService } from '~/app/services/storageService';
import { transferEmitter } from '~/app/utils/emitter';
import { buildTransferPath } from '~/app/utils/transferUtils';
import type { StorageLocation, FileInfo, FileListResponse } from '~/app/types/storage';

interface UseFileListOptions {
  selectedProject: string | null;
  selectedLocation: StorageLocation | null;
  currentPath: string;
  locationId?: string;
  encodedPath?: string;
}

interface UseFileListResult {
  files: FileInfo[];
  sortedFiles: FileInfo[];
  filesLoading: boolean;
  filesError: string | null;
  setFilesError: React.Dispatch<React.SetStateAction<string | null>>;
  searchText: string;
  setSearchText: React.Dispatch<React.SetStateAction<string>>;
  searchMode: 'startsWith' | 'contains';
  setSearchMode: React.Dispatch<React.SetStateAction<'startsWith' | 'contains'>>;
  hasMore: boolean;
  isLoadingMore: boolean;
  continuationToken: string | undefined;
  isTruncated: boolean;
  reloadFiles: () => void;
  loadMoreFiles: () => void;
  selectedFiles: Set<string>;
  setSelectedFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  previewFile: FileInfo | null;
  setPreviewFile: React.Dispatch<React.SetStateAction<FileInfo | null>>;
  downloadError: string | null;
  setDownloadError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useFileList({
  selectedProject,
  selectedLocation,
  currentPath,
  locationId,
  encodedPath,
}: UseFileListOptions): UseFileListResult {
  const navigate = useNavigate();

  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [continuationToken, setContinuationToken] = useState<string | undefined>();
  const [isTruncated, setIsTruncated] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [localOffset, setLocalOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | undefined>();
  const [pageLimit, setPageLimit] = useState(100);

  const [searchText, setSearchText] = useState('');
  const [searchMode, setSearchMode] = useState<'startsWith' | 'contains'>('startsWith');

  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeProjectRef = useRef(selectedProject);
  activeProjectRef.current = selectedProject;
  const restoredPathRef = useRef(false);
  const loadFilesRef = useRef<(append?: boolean, paginationOverrides?: { token?: string; offset?: number }) => Promise<void>>();

  const loadFiles = useCallback(
    async (append = false, paginationOverrides?: { token?: string; offset?: number }) => {
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

        const effectiveToken = paginationOverrides && 'token' in paginationOverrides ? paginationOverrides.token : continuationToken;
        const effectiveOffset = paginationOverrides && 'offset' in paginationOverrides ? paginationOverrides.offset : localOffset;

        const options: Parameters<typeof storageService.listFiles>[3] = {};
        if (location.type === 's3') {
          if (append && effectiveToken) {
            options.continuationToken = effectiveToken;
          }
          if (searchText.length >= 3 && searchMode === 'startsWith') {
            options.search = searchText;
            options.searchMode = 'startsWith';
          }
        } else {
          options.offset = append ? effectiveOffset : 0;
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

        if (restoredPathRef.current && currentPath && !append
            && response.files.length === 0 && !response.continuationToken) {
          restoredPathRef.current = false;
          navigate(`/brewet/storage/browse/${encodeURIComponent(location.id)}`);
          try { localStorage.setItem('brewet.selected-location', JSON.stringify({ locationId: location.id })); } catch { /* */ }
          return;
        }
        restoredPathRef.current = false;

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
        if (restoredPathRef.current && currentPath) {
          restoredPathRef.current = false;
          navigate(`/brewet/storage/browse/${encodeURIComponent(location.id)}`);
          try { localStorage.setItem('brewet.selected-location', JSON.stringify({ locationId: location.id })); } catch { /* */ }
          return;
        }
        restoredPathRef.current = false;
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

  const isInitialSearchRef = useRef(true);

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

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (isInitialSearchRef.current) {
      isInitialSearchRef.current = false;
      return;
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setContinuationToken(undefined);
      setLocalOffset(0);
      loadFilesRef.current?.(false, { token: undefined, offset: 0 });
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchText, searchMode]);

  useEffect(() => {
    const handler = ({ destination }: { destination: string }) => {
      if (!selectedLocation) return;
      const currentDest = buildTransferPath(selectedLocation, '');
      if (destination === currentDest || destination.startsWith(`${currentDest}/`)) {
        loadFilesRef.current?.();
      }
    };
    transferEmitter.on('transfer:completed', handler);
    return () => transferEmitter.off('transfer:completed', handler);
  }, [selectedLocation]);

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

  const hasMore =
    selectedLocation?.type === 's3'
      ? isTruncated
      : totalCount != null && localOffset < totalCount;

  const reloadFiles = useCallback(() => {
    loadFilesRef.current?.();
  }, []);

  const loadMoreFiles = useCallback(() => {
    loadFilesRef.current?.(true);
  }, []);

  return {
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
  };
}
