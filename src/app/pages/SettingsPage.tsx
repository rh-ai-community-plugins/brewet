import React from 'react';
import {
  PageSection,
  Title,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { CogIcon } from '@patternfly/react-icons';
import { ContainerRequired } from '~/app/components/ContainerRequired';

const SettingsPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Settings
    </Title>
    <ContainerRequired>
      <EmptyState headingLevel="h2" titleText="Coming soon" icon={CogIcon}>
        <EmptyStateBody>
          Configure S3, HuggingFace, proxy, transfer, and pagination settings.
        </EmptyStateBody>
      </EmptyState>
    </ContainerRequired>
  </PageSection>
);

export default SettingsPage;
