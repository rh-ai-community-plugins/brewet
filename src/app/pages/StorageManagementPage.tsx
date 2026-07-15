import React from 'react';
import {
  PageSection,
  Title,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { ContainerRequired } from '~/app/components/ContainerRequired';

const StorageManagementPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Storage Management
    </Title>
    <ContainerRequired>
      <EmptyState headingLevel="h2" titleText="Coming soon" icon={CubesIcon}>
        <EmptyStateBody>
          View and manage S3 buckets and PVC storage locations.
        </EmptyStateBody>
      </EmptyState>
    </ContainerRequired>
  </PageSection>
);

export default StorageManagementPage;
