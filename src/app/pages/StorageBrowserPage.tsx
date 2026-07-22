import React from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import {
  PageSection,
  Title,
} from '@patternfly/react-core';
import { ContainerRequired } from '~/app/components/ContainerRequired';
import ErrorBoundary from '~/app/components/ErrorBoundary';
import { StorageBrowser } from '~/app/components/StorageBrowser';

const StorageBrowserWithBoundary: React.FC = () => {
  const { locationId, path } = useParams<{ locationId?: string; path?: string }>();
  return (
    <ErrorBoundary key={`${locationId ?? ''}-${path ?? ''}`}>
      <StorageBrowser />
    </ErrorBoundary>
  );
};

const StorageBrowserContent: React.FC = () => (
  <Routes>
    <Route path="/" element={<StorageBrowserWithBoundary />} />
    <Route path=":locationId" element={<StorageBrowserWithBoundary />} />
    <Route path=":locationId/:path" element={<StorageBrowserWithBoundary />} />
  </Routes>
);

const StorageBrowserPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Storage Browser
    </Title>
    <ContainerRequired>
      <StorageBrowserContent />
    </ContainerRequired>
  </PageSection>
);

export default StorageBrowserPage;
