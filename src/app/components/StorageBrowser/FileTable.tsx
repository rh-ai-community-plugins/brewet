import React from 'react';
import {
  Button,
  Bullseye,
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
  FolderOpenIcon,
  FileIcon,
  DownloadIcon,
  TrashIcon,
  EyeIcon,
} from '@patternfly/react-icons';
import { isPreviewable, getFileType } from './DocumentRenderer';
import { formatBytes } from '~/app/utils/format';
import type { FileInfo } from '~/app/types/storage';

interface FileTableProps {
  files: FileInfo[];
  selectedFiles: Set<string>;
  onSelectFiles: (files: Set<string>) => void;
  onFileClick: (file: FileInfo) => void;
  onPreview: (file: FileInfo) => void;
  onDownload: (file: FileInfo) => void;
  onDelete: (file: FileInfo, triggerElement: HTMLButtonElement) => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  searchText: string;
}

const FileTable: React.FC<FileTableProps> = ({
  files,
  selectedFiles,
  onSelectFiles,
  onFileClick,
  onPreview,
  onDownload,
  onDelete,
  hasMore,
  isLoadingMore,
  onLoadMore,
  searchText,
}) => {
  return (
    <div>
      <span aria-live="polite" className="storage-browser__sr-only">
        {files.length} {files.length === 1 ? 'item' : 'items'} displayed{searchText ? ` for search "${searchText}"` : ''}
      </span>

      <Table aria-label="File listing" variant="compact">
        <Thead>
          <Tr>
            <Th
              screenReaderText="Select all"
              select={{
                onSelect: (_event, isSelected) => {
                  if (isSelected) {
                    onSelectFiles(new Set(files.map((f) => f.name)));
                  } else {
                    onSelectFiles(new Set());
                  }
                },
                isSelected: files.length > 0 && selectedFiles.size === files.length,
              }}
            />
            <Th width={35}>Name</Th>
            <Th width={20}>Last Modified</Th>
            <Th width={15}>Size</Th>
            <Th width={20}>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {files.length === 0 ? (
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
            files.map((file, rowIndex) => {
              const fileType = file.isDirectory ? undefined : getFileType(file.name);
              const canPreview = fileType != null && isPreviewable(fileType);
              return (
              <Tr
                key={file.name}
                isClickable={file.isDirectory || canPreview}
                onRowClick={
                  file.isDirectory
                    ? () => onFileClick(file)
                    : canPreview
                      ? () => onPreview(file)
                      : undefined
                }
              >
                <Td
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  select={{
                    rowIndex,
                    onSelect: (_event, isSelected) => {
                      const next = new Set(selectedFiles);
                      if (isSelected) {
                        next.add(file.name);
                      } else {
                        next.delete(file.name);
                      }
                      onSelectFiles(next);
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
                        onPreview(file);
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
                        onDownload(file);
                      }}
                    />
                  )}
                  <Button
                    variant="plain"
                    icon={<TrashIcon />}
                    aria-label={`Delete ${file.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(file, e.currentTarget as HTMLButtonElement);
                    }}
                  />
                </Td>
              </Tr>
              );
            })
          )}
        </Tbody>
      </Table>

      {hasMore && (
        <Bullseye className="pf-v6-u-mt-md pf-v6-u-mb-md">
          <Button
            variant="secondary"
            onClick={onLoadMore}
            isLoading={isLoadingMore}
            isDisabled={isLoadingMore}
          >
            Load More
          </Button>
        </Bullseye>
      )}
    </div>
  );
};

export default FileTable;
