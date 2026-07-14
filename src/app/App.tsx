import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import CommunityBanner from './components/CommunityBanner';
import { BrewetProvider } from './context/BrewetContext';
import { BrewetToolbar } from './components/BrewetToolbar';
import StorageBrowserPage from './pages/StorageBrowserPage';
import StorageManagementPage from './pages/StorageManagementPage';
import SettingsPage from './pages/SettingsPage';

const App: React.FC = () => (
  <BrewetProvider>
    <div className="community-plugin-layout">
      {/* [SHARED] Do not remove — all community plugins must display the CommunityBanner */}
      <CommunityBanner />
      <div className="community-plugin-content">
        <BrewetToolbar />
        <Routes>
          <Route path="/" element={<Navigate to="storage/browse" replace />} />
          <Route path="storage/browse/*" element={<StorageBrowserPage />} />
          <Route path="storage/manage/*" element={<StorageManagementPage />} />
          <Route path="settings/*" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  </BrewetProvider>
);

export default App;
