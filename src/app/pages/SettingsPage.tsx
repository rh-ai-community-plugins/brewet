import React from 'react';
import {
  PageSection,
  Title,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core';
import { CogIcon } from '@patternfly/react-icons';

const SettingsPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Settings
    </Title>
    <EmptyState headingLevel="h2" titleText="Coming soon" icon={CogIcon}>
      <EmptyStateBody>
        Configure S3, HuggingFace, proxy, transfer, and pagination settings.
      </EmptyStateBody>
    </EmptyState>
  </PageSection>
);

export default SettingsPage;
