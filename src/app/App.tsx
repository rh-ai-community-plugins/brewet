import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import CommunityBanner from './components/CommunityBanner';
import UserInfoPage from './pages/UserInfoPage';
import ClusterResourcesPage from './pages/ClusterResourcesPage';
import NamespaceSummaryPage from './pages/NamespaceSummaryPage';

const App: React.FC = () => (
  <div className="community-plugin-layout">
    {/* [SHARED] Do not remove — all community plugins must display the CommunityBanner */}
    <CommunityBanner />
    <div className="community-plugin-content">
      <Routes>
        <Route path="/" element={<Navigate to="user-info" replace />} />
        <Route path="user-info/*" element={<UserInfoPage />} />
        <Route path="cluster-resources/*" element={<ClusterResourcesPage />} />
        <Route path="namespace-summary/*" element={<NamespaceSummaryPage />} />
      </Routes>
    </div>
  </div>
);

export default App;
