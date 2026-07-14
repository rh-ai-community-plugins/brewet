import React, { useState, useCallback } from 'react';
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
    refreshContainerStatus,
  } = useBrewetContext();

  const [isScaling, setIsScaling] = useState(false);

  const statusConfig = STATUS_CONFIG[containerStatus];
  const canStart = containerStatus === 'stopped';
  const canStop = containerStatus === 'running' || containerStatus === 'starting' || containerStatus === 'error';
  const hasContainer = containerStatus !== 'none';

  const handleStartStop = useCallback(() => {
    if (!selectedProject || isScaling) return;

    const replicas = canStart ? 1 : 0;
    setIsScaling(true);

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
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Scale request failed: ${res.status}`);
        }
        setTimeout(refreshContainerStatus, 1000);
      })
      .catch((err: unknown) => {
        console.error('Scale operation failed:', err);
        refreshContainerStatus();
      })
      .finally(() => {
        setIsScaling(false);
      });
  }, [selectedProject, isScaling, canStart, refreshContainerStatus]);

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
              <Label
                color={statusConfig.color}
                icon={containerStatus === 'starting' ? <Spinner size="sm" /> : undefined}
              >
                {statusConfig.text}
              </Label>
            </ToolbarItem>

            {hasContainer && (canStart || canStop) && (
              <ToolbarItem>
                <Button
                  variant="plain"
                  aria-label={canStart ? 'Start container' : 'Stop container'}
                  onClick={handleStartStop}
                  isDisabled={isScaling}
                  icon={canStart ? <PlayIcon /> : <StopIcon />}
                />
              </ToolbarItem>
            )}

            {hasContainer && (
              <ToolbarItem>
                <Button
                  variant="plain"
                  aria-label="Edit container configuration"
                  isDisabled
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
