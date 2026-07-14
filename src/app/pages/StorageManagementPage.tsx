import React from 'react';
import {
  PageSection,
  Title,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';

const StorageManagementPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Storage Management
    </Title>
    <EmptyState headingLevel="h2" titleText="Coming soon" icon={CubesIcon}>
      <EmptyStateBody>
        View and manage S3 buckets and PVC storage locations.
      </EmptyStateBody>
    </EmptyState>
  </PageSection>
);

export default StorageManagementPage;
