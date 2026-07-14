import React from 'react';
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  Button,
  Label,
  Spinner,
} from '@patternfly/react-core';
import {
  PlayIcon,
  StopIcon,
  PencilAltIcon,
} from '@patternfly/react-icons';
import { ProjectSelector } from '~/app/components/ProjectSelector';
import { useBrewetContext, ContainerStatus } from '~/app/context/BrewetContext';

const STATUS_CONFIG: Record<ContainerStatus, { text: string; color: 'grey' | 'green' | 'blue' | 'red' }> = {
  none: { text: 'No Container', color: 'grey' },
  stopped: { text: 'Stopped', color: 'grey' },
  running: { text: 'Running', color: 'green' },
  starting: { text: 'Starting', color: 'blue' },
  error: { text: 'Error', color: 'red' },
};

export const BrewetToolbar: React.FC = () => {
  const {
    selectedProject,
    setSelectedProject,
    containerStatus,
  } = useBrewetContext();

  const statusConfig = STATUS_CONFIG[containerStatus];
  const canStart = containerStatus === 'stopped';
  const canStop = containerStatus === 'running';
  const hasContainer = containerStatus !== 'none';

  const handleStartStop = () => {
    if (!selectedProject) return;

    const replicas = canStart ? 1 : 0;
    fetch(
      `/api/k8s/apis/apps/v1/namespaces/${encodeURIComponent(selectedProject)}/deployments/brewet-storage-backend/scale`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiVersion: 'autoscaling/v1',
          kind: 'Scale',
          metadata: { name: 'brewet-storage-backend', namespace: selectedProject },
          spec: { replicas },
        }),
      },
    );
  };

  return (
    <Toolbar>
      <ToolbarContent>
        <ToolbarItem>
          <ProjectSelector
            selectedProject={selectedProject}
            onSelect={setSelectedProject}
          />
        </ToolbarItem>

        {selectedProject && (
          <ToolbarGroup align={{ default: 'alignEnd' }}>
            <ToolbarItem>
              <Label color={statusConfig.color}>
                {containerStatus === 'starting' && (
                  <Spinner size="sm" />
                )}{' '}
                {statusConfig.text}
              </Label>
            </ToolbarItem>

            {hasContainer && (canStart || canStop) && (
              <ToolbarItem>
                <Button
                  variant="plain"
                  aria-label={canStart ? 'Start container' : 'Stop container'}
                  onClick={handleStartStop}
                  icon={canStart ? <PlayIcon /> : <StopIcon />}
                />
              </ToolbarItem>
            )}

            {hasContainer && (
              <ToolbarItem>
                <Button
                  variant="plain"
                  aria-label="Edit container configuration"
                  icon={<PencilAltIcon />}
                />
              </ToolbarItem>
            )}
          </ToolbarGroup>
        )}
      </ToolbarContent>
    </Toolbar>
  );
};
