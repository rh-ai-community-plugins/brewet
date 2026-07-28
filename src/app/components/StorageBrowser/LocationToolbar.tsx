import React, { useState, useRef } from 'react';
import {
  Breadcrumb,
  BreadcrumbItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Button,
  MenuToggle,
  Select,
  SelectOption,
  SelectList,
  Label,
  Tooltip,
} from '@patternfly/react-core';
import {
  CloudIcon,
  FolderIcon,
  CopyIcon,
  CheckIcon,
} from '@patternfly/react-icons';
import type { StorageLocation } from '~/app/types/storage';

interface PathSegment {
  label: string;
  path: string;
}

interface LocationToolbarProps {
  locations: StorageLocation[];
  selectedLocation: StorageLocation | null;
  locationId?: string;
  pathSegments: PathSegment[];
  currentPath: string;
  onSelectLocation: (locationId: string) => void;
  onNavigateToPath: (path: string) => void;
}

const LocationToolbar: React.FC<LocationToolbarProps> = ({
  locations,
  selectedLocation,
  locationId,
  pathSegments,
  currentPath,
  onSelectLocation,
  onNavigateToPath,
}) => {
  const [locationSelectOpen, setLocationSelectOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  return (
    <Toolbar>
      <ToolbarContent alignItems="center">
        <ToolbarItem>
          <span className="pf-v6-u-font-weight-bold">Location:</span>
        </ToolbarItem>
        <ToolbarItem>
          <Select
            isOpen={locationSelectOpen}
            onOpenChange={setLocationSelectOpen}
            onSelect={(_e, value) => {
              if (typeof value === 'string') {
                onSelectLocation(value);
                setLocationSelectOpen(false);
              }
            }}
            selected={locationId}
            toggle={(toggleRef) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setLocationSelectOpen((prev) => !prev)}
                isExpanded={locationSelectOpen}
                className="storage-browser__location-toggle"
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
        {selectedLocation && (
          <ToolbarItem>
            <Breadcrumb>
              <BreadcrumbItem
                isActive={pathSegments.length === 0}
                onClick={pathSegments.length > 0 ? () => onNavigateToPath('') : undefined}
                component={pathSegments.length > 0 ? 'button' : undefined}
              >
                <FolderIcon />
              </BreadcrumbItem>
              {pathSegments.map((seg, idx) => (
                <BreadcrumbItem
                  key={seg.path}
                  isActive={idx === pathSegments.length - 1}
                  onClick={
                    idx < pathSegments.length - 1
                      ? () => onNavigateToPath(seg.path)
                      : undefined
                  }
                  component={idx < pathSegments.length - 1 ? 'button' : undefined}
                >
                  {seg.label}
                </BreadcrumbItem>
              ))}
            </Breadcrumb>
          </ToolbarItem>
        )}
        {selectedLocation && currentPath && (
          <ToolbarItem>
            <Tooltip content={copied ? 'Copied!' : 'Copy path'}>
              <Button
                variant="plain"
                aria-label="Copy path to clipboard"
                icon={copied ? <CheckIcon color="var(--pf-t--global--color--status--success--default)" /> : <CopyIcon />}
                onClick={() => {
                  navigator.clipboard.writeText(currentPath.replace(/\/$/, ''));
                  setCopied(true);
                  if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
                  copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
                }}
                size="sm"
              />
            </Tooltip>
          </ToolbarItem>
        )}
      </ToolbarContent>
    </Toolbar>
  );
};

export default LocationToolbar;
