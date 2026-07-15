import React, { useState } from 'react';
import {
  EmptyState,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Button,
  Spinner,
} from '@patternfly/react-core';
import { CubesIcon, ExclamationCircleIcon } from '@patternfly/react-icons';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { ContainerWizard } from '~/app/components/ContainerWizard';

interface ContainerRequiredProps {
  children: React.ReactNode;
}

export const ContainerRequired: React.FC<ContainerRequiredProps> = ({ children }) => {
  const { selectedProject, containerStatus } = useBrewetContext();
  const { startContainer, stopContainer, isActioning, refreshContainerStatus } = useBrewetContainer();
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  if (!selectedProject) {
    return (
      <EmptyState headingLevel="h2" titleText="Select a project" icon={CubesIcon}>
        <EmptyStateBody>
          Select a project from the toolbar to get started with storage management.
        </EmptyStateBody>
      </EmptyState>
    );
  }

  if (containerStatus === 'none') {
    return (
      <>
        <EmptyState headingLevel="h2" titleText="No storage container" icon={CubesIcon}>
          <EmptyStateBody>
            No Brewet storage container exists in this project. Create one to start
            browsing and managing your S3 and PVC storage.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={() => setIsWizardOpen(true)}>
                Create Container
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
        <ContainerWizard isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
      </>
    );
  }

  if (containerStatus === 'stopped') {
    return (
      <EmptyState headingLevel="h2" titleText="Container stopped" icon={CubesIcon}>
        <EmptyStateBody>
          The storage container in this project is stopped. Start it to access your
          storage.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button
              variant="primary"
              onClick={startContainer}
              isLoading={isActioning}
              isDisabled={isActioning}
            >
              Start Container
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    );
  }

  if (containerStatus === 'starting') {
    return (
      <EmptyState headingLevel="h2" titleText="Container starting" icon={CubesIcon}>
        <EmptyStateBody>
          <Spinner size="lg" aria-label="Container starting" />
          {' '}The storage container is starting up. This may take a moment.
        </EmptyStateBody>
      </EmptyState>
    );
  }

  if (containerStatus === 'error') {
    return (
      <EmptyState headingLevel="h2" titleText="Container error" icon={ExclamationCircleIcon}>
        <EmptyStateBody>
          The storage container encountered an error. Try stopping and restarting it.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button
              variant="primary"
              onClick={stopContainer}
              isLoading={isActioning}
              isDisabled={isActioning}
            >
              Stop Container
            </Button>
            <Button variant="link" onClick={refreshContainerStatus}>
              Refresh Status
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    );
  }

  return <>{children}</>;
};
