// [SHARED] Common section for all community plugins — never changes across plugins.
// Do not change the id or name: all community plugins share this section
// so they appear grouped together in the dashboard sidebar.
export const communityPluginsSectionExtension = {
  type: 'app.navigation/section' as const,
  properties: {
    id: 'community-plugins', // [SHARED] common section for all community plugins
    title: 'Community plugins', // [SHARED]
    group: '9_plugins', // [SHARED]
    iconRef: () => import('./CommunityNavIcon'),
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
    iconRef: () => import('~/app/components/BrewetNavIcon'),
  },
};

export const userInfoNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'brewet-user-info', // [PLUGIN-SPECIFIC] unique nav item ID
    title: 'User Info',
    href: '/brewet/user-info', // [PLUGIN-SPECIFIC] must match route prefix
    section: 'brewet', // [PLUGIN-SPECIFIC] references this plugin's section ID
    path: '/brewet/user-info/*', // [PLUGIN-SPECIFIC] route-matching pattern
  },
};

export const clusterResourcesNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'brewet-cluster-resources', // [PLUGIN-SPECIFIC] unique nav item ID
    title: 'Cluster Resources',
    href: '/brewet/cluster-resources', // [PLUGIN-SPECIFIC] must match route prefix
    section: 'brewet', // [PLUGIN-SPECIFIC] references this plugin's section ID
    path: '/brewet/cluster-resources/*', // [PLUGIN-SPECIFIC] route-matching pattern
  },
};

export const namespaceSummaryNavExtension = {
  type: 'app.navigation/href' as const,
  properties: {
    id: 'brewet-namespace-summary', // [PLUGIN-SPECIFIC] unique nav item ID
    title: 'Namespace Summary',
    href: '/brewet/namespace-summary', // [PLUGIN-SPECIFIC] must match route prefix
    section: 'brewet', // [PLUGIN-SPECIFIC] references this plugin's section ID
    path: '/brewet/namespace-summary/*', // [PLUGIN-SPECIFIC] route-matching pattern
  },
};

export const brewetRouteExtension = {
  type: 'app.route' as const,
  properties: {
    path: '/brewet/*', // [PLUGIN-SPECIFIC] top-level route prefix
    component: () => import('~/app/App'),
  },
};

export const extensions = [
  communityPluginsSectionExtension,
  brewetAreaExtension,
  brewetSectionExtension,
  userInfoNavExtension,
  clusterResourcesNavExtension,
  namespaceSummaryNavExtension,
  brewetRouteExtension,
];

export default extensions;
