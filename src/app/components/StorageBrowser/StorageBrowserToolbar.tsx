import React from 'react';
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Button,
  SearchInput,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core';
import {
  UploadIcon,
  SyncIcon,
  PlusCircleIcon,
  ExternalLinkAltIcon,
} from '@patternfly/react-icons';

interface StorageBrowserToolbarProps {
  searchText: string;
  onSearchChange: (value: string) => void;
  searchMode: 'startsWith' | 'contains';
  onSearchModeChange: (mode: 'startsWith' | 'contains') => void;
  onUploadClick: () => void;
  onCreateFolderClick: () => void;
  onImportClick: () => void;
  onRefreshClick: () => void;
  uploadButtonRef: React.RefObject<HTMLButtonElement | null>;
  createFolderButtonRef: React.RefObject<HTMLButtonElement | null>;
}

const StorageBrowserToolbar: React.FC<StorageBrowserToolbarProps> = ({
  searchText,
  onSearchChange,
  searchMode,
  onSearchModeChange,
  onUploadClick,
  onCreateFolderClick,
  onImportClick,
  onRefreshClick,
  uploadButtonRef,
  createFolderButtonRef,
}) => {
  return (
    <Toolbar>
      <ToolbarContent>
        <ToolbarGroup>
          <ToolbarItem>
            <SearchInput
              placeholder="Search files..."
              value={searchText}
              onChange={(_event, value) => onSearchChange(value)}
              onClear={() => onSearchChange('')}
            />
          </ToolbarItem>
          <ToolbarItem>
            <ToggleGroup aria-label="Search mode">
              <ToggleGroupItem
                text="Prefix"
                buttonId="search-prefix"
                isSelected={searchMode === 'startsWith'}
                onChange={() => onSearchModeChange('startsWith')}
              />
              <ToggleGroupItem
                text="Contains"
                buttonId="search-contains"
                isSelected={searchMode === 'contains'}
                onChange={() => onSearchModeChange('contains')}
              />
            </ToggleGroup>
          </ToolbarItem>
        </ToolbarGroup>
        <ToolbarGroup align={{ default: 'alignEnd' }}>
          <ToolbarItem>
            <Button
              ref={uploadButtonRef}
              variant="primary"
              icon={<UploadIcon />}
              onClick={onUploadClick}
            >
              Upload
            </Button>
          </ToolbarItem>
          <ToolbarItem>
            <Button
              ref={createFolderButtonRef}
              variant="secondary"
              icon={<PlusCircleIcon />}
              onClick={onCreateFolderClick}
            >
              Create Folder
            </Button>
          </ToolbarItem>
          <ToolbarItem>
            <Button
              variant="secondary"
              icon={<ExternalLinkAltIcon />}
              onClick={onImportClick}
            >
              Import from HuggingFace
            </Button>
          </ToolbarItem>
          <ToolbarItem>
            <Button
              variant="plain"
              icon={<SyncIcon />}
              onClick={onRefreshClick}
              aria-label="Refresh"
            />
          </ToolbarItem>
        </ToolbarGroup>
      </ToolbarContent>
    </Toolbar>
  );
};

export default StorageBrowserToolbar;
