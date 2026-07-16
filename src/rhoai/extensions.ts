// [SHARED] Common section for all community plugins — never changes across plugins.
// Do not change the id or name: all community plugins share this section
// so they appear grouped together in the dashboard sidebar.
export const communityPluginsSectionExtension = {
  type: 'app.navigation/section' as const,
  properties: {
    id: 'community-plugins', // [SHARED] common section for all community plugins
    title: 'Community plugins', // [SHARED]
    group: '9_plugins', // [SHARED]
    iconRef: () => import(/* webpackMode: "eager" */ './CommunityNavIcon'),
  },
};

// [PLUGIN-SPECIFIC] Everything below is specific to this plugin

export const brewetAreaExtension = {
  type: 'app.area' as const,
  properties: {
    id: 'brewet', // [PLUGIN-SPECIFIC] unique area ID
    featureFlags: [] as string[],
  },
};

export const brewetSectionExtension = {
  type: 'app.navigation/section' as const,
  properties: {
    id: 'brewet', // [PLUGIN-SPECIFIC] unique nav section ID
    title: 'Brewet', // [PLUGIN-SPECIFIC] display name in sidebar
    group: '1_brewet', // [PLUGIN-SPECIFIC] sort key within community-plugins
    section: 'community-plugins', // [SHARED] must match communityPluginsSectionExtension.id — do not change
    iconRef: () => import(/* webpackMode: "eager" */ '~/app/components/BrewetNavIcon'),
  },
};

export const storageSectionExtension = {
  type: 'app.navigation/section' as const,
  properties: {
    id: 'brewet-storage',
    title: 'Storage',
    section: 'brewet',
  },
};

export const storageBrowserNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'brewet-storage-browser',
    title: 'Storage Browser',
    href: '/brewet/storage/browse',
    section: 'brewet-storage',
    path: '/brewet/storage/browse/*',
  },
};

export const storageManagementNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'brewet-storage-management',
    title: 'Storage Management',
    href: '/brewet/storage/manage',
    section: 'brewet-storage',
    path: '/brewet/storage/manage/*',
  },
};

export const settingsNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'brewet-settings',
    title: 'Settings',
    href: '/brewet/settings',
    section: 'brewet',
    path: '/brewet/settings/*',
  },
};

export const brewetRouteExtension = {
  type: 'app.route' as const,
  properties: {
    path: '/brewet/*', // [PLUGIN-SPECIFIC] top-level route prefix
    component: () => import(/* webpackMode: "eager" */ '~/app/App'),
  },
};

export const extensions = [
  communityPluginsSectionExtension,
  brewetAreaExtension,
  brewetSectionExtension,
  storageSectionExtension,
  storageBrowserNavExtension,
  storageManagementNavExtension,
  settingsNavExtension,
  brewetRouteExtension,
];

export default extensions;
