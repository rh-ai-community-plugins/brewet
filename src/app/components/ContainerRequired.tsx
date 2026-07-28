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

  let content: React.ReactNode;

  if (!selectedProject) {
    content = (
      <EmptyState headingLevel="h2" titleText="Select a project" icon={CubesIcon}>
        <EmptyStateBody>
          Select a project from the toolbar to get started with storage management.
        </EmptyStateBody>
      </EmptyState>
    );
  } else if (containerStatus === 'none') {
    content = (
      <EmptyState headingLevel="h2" titleText="Brewet not set up" icon={CubesIcon}>
        <EmptyStateBody>
          Brewet is not set up in this project. Set it up to start
          browsing and managing your S3 and PVC storage.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button variant="primary" onClick={() => setIsWizardOpen(true)}>
              Set Up Brewet
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    );
  } else if (containerStatus === 'stopped') {
    content = (
      <EmptyState headingLevel="h2" titleText="Brewet stopped" icon={CubesIcon}>
        <EmptyStateBody>
          Brewet is stopped in this project. Start it to access your
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
              Start Brewet
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    );
  } else if (containerStatus === 'starting') {
    content = (
      <EmptyState headingLevel="h2" titleText="Brewet starting" icon={CubesIcon}>
        <EmptyStateBody>
          <Spinner size="lg" aria-label="Brewet starting" />
          {' '}Brewet is starting up. This may take a moment.
        </EmptyStateBody>
      </EmptyState>
    );
  } else if (containerStatus === 'error') {
    content = (
      <EmptyState headingLevel="h2" titleText="Brewet error" icon={ExclamationCircleIcon}>
        <EmptyStateBody>
          Brewet encountered an error. Try stopping and restarting it.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button
              variant="primary"
              onClick={stopContainer}
              isLoading={isActioning}
              isDisabled={isActioning}
            >
              Stop Brewet
            </Button>
            <Button variant="link" onClick={refreshContainerStatus}>
              Refresh Status
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    );
  } else {
    content = children;
  }

  return (
    <>
      {content}
      {isWizardOpen && <ContainerWizard onClose={() => setIsWizardOpen(false)} />}
    </>
  );
};
