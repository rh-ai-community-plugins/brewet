import {
  brewetAreaExtension,
  communityPluginsSectionExtension,
  brewetSectionExtension,
  userInfoNavExtension,
  clusterResourcesNavExtension,
  namespaceSummaryNavExtension,
  brewetRouteExtension,
  extensions,
} from '../extensions';

describe('RHOAI Plugin Extensions', () => {
  describe('brewetAreaExtension', () => {
    it('should have the correct type and id', () => {
      expect(brewetAreaExtension.type).toBe('app.area');
      expect(brewetAreaExtension.properties.id).toBe('brewet');
    });

    it('should have an empty featureFlags array', () => {
      expect(brewetAreaExtension.properties.featureFlags).toEqual([]);
    });
  });

  describe('communityPluginsSectionExtension', () => {
    it('should define the community-plugins section', () => {
      expect(communityPluginsSectionExtension.type).toBe('app.navigation/section');
      expect(communityPluginsSectionExtension.properties.id).toBe('community-plugins');
      expect(communityPluginsSectionExtension.properties.title).toBe('Community plugins');
      expect(communityPluginsSectionExtension.properties.group).toBe('9_plugins');
    });

    it('should have an iconRef function', () => {
      expect(typeof communityPluginsSectionExtension.properties.iconRef).toBe('function');
    });
  });

  describe('brewetSectionExtension', () => {
    it('should define a subsection nested under community-plugins', () => {
      expect(brewetSectionExtension.type).toBe('app.navigation/section');
      expect(brewetSectionExtension.properties.id).toBe('brewet');
      expect(brewetSectionExtension.properties.title).toBe('Brewet');
      expect(brewetSectionExtension.properties.group).toBe('1_brewet');
      expect(brewetSectionExtension.properties.section).toBe('community-plugins');
      expect(typeof brewetSectionExtension.properties.iconRef).toBe('function');
    });
  });

  describe('navigation extensions', () => {
    it('should define User Info nav item under brewet section', () => {
      expect(userInfoNavExtension.type).toBe('app.navigation/href');
      expect(userInfoNavExtension.properties.id).toBe('brewet-user-info');
      expect(userInfoNavExtension.properties.title).toBe('User Info');
      expect(userInfoNavExtension.properties.href).toBe('/brewet/user-info');
      expect(userInfoNavExtension.properties.section).toBe('brewet');
      expect(userInfoNavExtension.properties.path).toBe('/brewet/user-info/*');
    });

    it('should define Cluster Resources nav item under brewet section', () => {
      expect(clusterResourcesNavExtension.type).toBe('app.navigation/href');
      expect(clusterResourcesNavExtension.properties.id).toBe('brewet-cluster-resources');
      expect(clusterResourcesNavExtension.properties.title).toBe('Cluster Resources');
      expect(clusterResourcesNavExtension.properties.href).toBe('/brewet/cluster-resources');
      expect(clusterResourcesNavExtension.properties.section).toBe('brewet');
      expect(clusterResourcesNavExtension.properties.path).toBe('/brewet/cluster-resources/*');
    });

    it('should define Namespace Summary nav item under brewet section', () => {
      expect(namespaceSummaryNavExtension.type).toBe('app.navigation/href');
      expect(namespaceSummaryNavExtension.properties.id).toBe('brewet-namespace-summary');
      expect(namespaceSummaryNavExtension.properties.title).toBe('Namespace Summary');
      expect(namespaceSummaryNavExtension.properties.href).toBe('/brewet/namespace-summary');
      expect(namespaceSummaryNavExtension.properties.section).toBe('brewet');
      expect(namespaceSummaryNavExtension.properties.path).toBe('/brewet/namespace-summary/*');
    });
  });

  describe('route extension', () => {
    it('should define a single wildcard route with lazy component', () => {
      expect(brewetRouteExtension.type).toBe('app.route');
      expect(brewetRouteExtension.properties.path).toBe('/brewet/*');
      expect(typeof brewetRouteExtension.properties.component).toBe('function');
      expect(brewetRouteExtension.properties.component()).toBeInstanceOf(Promise);
    });
  });

  describe('extensions array', () => {
    it('should contain all seven extensions', () => {
      expect(extensions).toHaveLength(7);
    });

    it('should include all extensions in the correct order', () => {
      expect(extensions).toEqual([
        communityPluginsSectionExtension,
        brewetAreaExtension,
        brewetSectionExtension,
        userInfoNavExtension,
        clusterResourcesNavExtension,
        namespaceSummaryNavExtension,
        brewetRouteExtension,
      ]);
    });
  });
});
