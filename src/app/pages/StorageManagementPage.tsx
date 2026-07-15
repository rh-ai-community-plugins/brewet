import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  PageSection,
  Title,
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
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
  Label,
  Bullseye,
  Spinner,
  Alert,
  SearchInput,
} from '@patternfly/react-core';
import {
  Table,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
  ThProps,
} from '@patternfly/react-table';
import { CloudIcon, FolderIcon, SyncIcon, TrashIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { useNavigate } from 'react-router-dom';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { ContainerRequired } from '~/app/components/ContainerRequired';
import { storageService } from '~/app/services/storageService';
import type { StorageLocation } from '~/app/types/storage';

const BUCKET_NAME_REGEX = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const IP_ADDRESS_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

function validateBucketName(name: string, existingNames: string[]): string | null {
  if (!name) return 'Bucket name is required.';
  if (name.length < 3 || name.length > 63) return 'Bucket name must be between 3 and 63 characters.';
  if (!BUCKET_NAME_REGEX.test(name)) return 'Bucket name must start and end with a letter or number, and can only contain lowercase letters, numbers, hyphens, and periods.';
  if (name.includes('..')) return 'Bucket name must not contain consecutive periods.';
  if (name.includes('.-') || name.includes('-.')) return 'Bucket name must not contain a period next to a hyphen.';
  if (IP_ADDRESS_REGEX.test(name)) return 'Bucket name must not be formatted as an IP address.';
  if (existingNames.includes(name)) return 'A bucket with this name already exists.';
  return null;
}

type SortColumn = 'type' | 'name' | 'created' | 'status';

const StorageManagementContent: React.FC = () => {
  const { selectedProject } = useBrewetContext();
  const navigate = useNavigate();

  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<StorageLocation | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const activeProjectRef = useRef(selectedProject);
  activeProjectRef.current = selectedProject;

  const loadData = useCallback(
    async (refresh = false) => {
      if (!selectedProject) return;
      const project = selectedProject;
      try {
        if (refresh) setIsRefreshing(true);
        else setLoading(true);
        setError(null);

        const locs = refresh
          ? await storageService.refreshLocations(project)
          : await storageService.getLocations(project);
        if (activeProjectRef.current !== project) return;
        setLocations(locs);
      } catch (err) {
        if (activeProjectRef.current !== project) return;
        setError(err instanceof Error ? err.message : 'Failed to load storage locations.');
      } finally {
        if (activeProjectRef.current === project) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [selectedProject],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const s3BucketNames = useMemo(
    () => locations.filter((l) => l.type === 's3').map((l) => l.name),
    [locations],
  );

  const filteredLocations = useMemo(() => {
    let filtered = locations;
    if (searchText) {
      const lower = searchText.toLowerCase();
      filtered = filtered.filter((l) => l.name.toLowerCase().includes(lower));
    }
    return [...filtered].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      switch (sortColumn) {
        case 'type':
          return dir * a.type.localeCompare(b.type);
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'created': {
          const dateA = a.creationDate ?? '';
          const dateB = b.creationDate ?? '';
          return dir * dateA.localeCompare(dateB);
        }
        case 'status':
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });
  }, [locations, searchText, sortColumn, sortDirection]);

  const getSortParams = (column: SortColumn): ThProps['sort'] => ({
    sortBy: {
      index: ['type', 'name', 'created', 'status'].indexOf(sortColumn),
      direction: sortDirection,
    },
    onSort: (_event, _index, direction) => {
      setSortColumn(column);
      setSortDirection(direction);
    },
    columnIndex: ['type', 'name', 'created', 'status'].indexOf(column),
  });

  const handleCreateBucket = async () => {
    const validationError = validateBucketName(newBucketName, s3BucketNames);
    if (validationError) {
      setCreateError(validationError);
      return;
    }
    if (!selectedProject) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      await storageService.createBucket(selectedProject, newBucketName);
      setIsCreateOpen(false);
      setNewBucketName('');
      await loadData(true);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create bucket.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteBucket = async () => {
    if (!deleteTarget || !selectedProject) return;

    setIsDeleting(true);
    setDeleteError(null);
    try {
      await storageService.deleteBucket(selectedProject, deleteTarget.name);
      setDeleteTarget(null);
      setDeleteConfirmName('');
      await loadData(true);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete bucket.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRowClick = (location: StorageLocation) => {
    navigate(`/brewet/storage/browse/${encodeURIComponent(location.id)}`);
  };

  if (loading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading storage locations" />
      </Bullseye>
    );
  }

  if (error) {
    return (
      <Alert variant="danger" title="Error loading storage locations" isInline>
        {error}
      </Alert>
    );
  }

  return (
    <>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <SearchInput
              placeholder="Filter by name..."
              value={searchText}
              onChange={(_event, value) => setSearchText(value)}
              onClear={() => setSearchText('')}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Button
              variant="primary"
              icon={<PlusCircleIcon />}
              onClick={() => {
                setNewBucketName('');
                setCreateError(null);
                setIsCreateOpen(true);
              }}
            >
              Create Bucket
            </Button>
          </ToolbarItem>
          <ToolbarItem>
            <Button
              variant="plain"
              icon={<SyncIcon />}
              onClick={() => loadData(true)}
              isDisabled={isRefreshing}
              aria-label="Refresh"
            />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>

      <Table aria-label="Storage locations" variant="compact">
        <Thead>
          <Tr>
            <Th sort={getSortParams('type')} width={10}>Type</Th>
            <Th sort={getSortParams('name')}>Name</Th>
            <Th sort={getSortParams('created')} width={20}>Created</Th>
            <Th sort={getSortParams('status')} width={15}>Status</Th>
            <Th width={10}>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {filteredLocations.length === 0 ? (
            <Tr>
              <Td colSpan={5}>
                <Bullseye>No storage locations found.</Bullseye>
              </Td>
            </Tr>
          ) : (
            filteredLocations.map((location) => (
              <Tr
                key={location.id}
                isClickable
                onRowClick={() => handleRowClick(location)}
              >
                <Td dataLabel="Type">
                  {location.type === 's3' ? (
                    <Label color="blue" icon={<CloudIcon />}>S3</Label>
                  ) : (
                    <Label color="green" icon={<FolderIcon />}>PVC</Label>
                  )}
                </Td>
                <Td dataLabel="Name">{location.name}</Td>
                <Td dataLabel="Created">
                  {location.creationDate
                    ? new Date(location.creationDate).toLocaleDateString()
                    : '—'}
                </Td>
                <Td dataLabel="Status">
                  <Label color={location.status === 'available' ? 'green' : 'red'}>
                    {location.status}
                  </Label>
                </Td>
                <Td dataLabel="Actions" isActionCell>
                  {location.type === 's3' && (
                    <Button
                      variant="plain"
                      icon={<TrashIcon />}
                      aria-label={`Delete bucket ${location.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmName('');
                        setDeleteError(null);
                        setDeleteTarget(location);
                      }}
                    />
                  )}
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        aria-label="Create S3 bucket"
        variant="small"
      >
        <ModalHeader title="Create S3 Bucket" />
        <ModalBody>
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              handleCreateBucket();
            }}
          >
            <FormGroup label="Bucket name" isRequired fieldId="bucket-name">
              <TextInput
                id="bucket-name"
                value={newBucketName}
                onChange={(_event, value) => {
                  setNewBucketName(value);
                  setCreateError(null);
                }}
                isRequired
                validated={createError ? 'error' : 'default'}
              />
              {createError && (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem variant="error">{createError}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              )}
            </FormGroup>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            onClick={handleCreateBucket}
            isLoading={isCreating}
            isDisabled={isCreating || !newBucketName}
          >
            Create
          </Button>
          <Button variant="link" onClick={() => setIsCreateOpen(false)}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      {deleteTarget && (
        <Modal
          isOpen
          onClose={() => setDeleteTarget(null)}
          aria-label="Delete S3 bucket"
          variant="small"
        >
          <ModalHeader title="Delete S3 Bucket" />
          <ModalBody>
            <Alert variant="warning" title="This action cannot be undone" isInline isPlain>
              All objects in the bucket will be permanently deleted.
            </Alert>
            <Form className="pf-v6-u-mt-md">
              <FormGroup
                label={`Type "${deleteTarget.name}" to confirm`}
                isRequired
                fieldId="delete-confirm"
              >
                <TextInput
                  id="delete-confirm"
                  value={deleteConfirmName}
                  onChange={(_event, value) => {
                    setDeleteConfirmName(value);
                    setDeleteError(null);
                  }}
                  validated={deleteError ? 'error' : 'default'}
                />
                {deleteError && (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem variant="error">{deleteError}</HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                )}
              </FormGroup>
            </Form>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="danger"
              onClick={handleDeleteBucket}
              isLoading={isDeleting}
              isDisabled={isDeleting || deleteConfirmName !== deleteTarget.name}
            >
              Delete
            </Button>
            <Button variant="link" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  );
};

const StorageManagementPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Storage Management
    </Title>
    <ContainerRequired>
      <StorageManagementContent />
    </ContainerRequired>
  </PageSection>
);

export default StorageManagementPage;
