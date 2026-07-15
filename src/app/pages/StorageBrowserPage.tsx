import React from 'react';
import { Routes, Route } from 'react-router-dom';
import {
  PageSection,
  Title,
} from '@patternfly/react-core';
import { ContainerRequired } from '~/app/components/ContainerRequired';
import { StorageBrowser } from '~/app/components/StorageBrowser';

const StorageBrowserContent: React.FC = () => (
  <Routes>
    <Route path="/" element={<StorageBrowser />} />
    <Route path=":locationId" element={<StorageBrowser />} />
    <Route path=":locationId/:path" element={<StorageBrowser />} />
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
