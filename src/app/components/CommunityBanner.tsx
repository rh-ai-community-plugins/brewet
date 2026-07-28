// [SHARED] Do not remove or modify — this banner identifies pages as community
// plugins. All community plugins must display it. See also CommunityBanner.css.
import React from 'react';
import BrewetIcon from './BrewetNavIcon';
import './CommunityBanner.css';

const CommunityBanner: React.FC = () => (
  <div className="community-plugin-banner">
    Community Plugin &mdash; Brewet <BrewetIcon />
  </div>
);

export default CommunityBanner;
