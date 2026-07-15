import React from 'react';
import {
  PageSection,
  Title,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { SearchIcon } from '@patternfly/react-icons';
import { ContainerRequired } from '~/app/components/ContainerRequired';

const StorageBrowserPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Storage Browser
    </Title>
    <ContainerRequired>
      <EmptyState headingLevel="h2" titleText="Coming soon" icon={SearchIcon}>
        <EmptyStateBody>
          Browse and manage files across S3 buckets and PVC storage locations.
        </EmptyStateBody>
      </EmptyState>
    </ContainerRequired>
  </PageSection>
);

export default StorageBrowserPage;
