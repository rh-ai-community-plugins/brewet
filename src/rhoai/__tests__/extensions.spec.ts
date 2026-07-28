import {
  brewetAreaExtension,
  communityPluginsSectionExtension,
  brewetSectionExtension,
  storageSectionExtension,
  storageBrowserNavExtension,
  storageManagementNavExtension,
  settingsNavExtension,
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

  describe('storageSectionExtension', () => {
    it('should define a Storage subsection under brewet', () => {
      expect(storageSectionExtension.type).toBe('app.navigation/section');
      expect(storageSectionExtension.properties.id).toBe('brewet-storage');
      expect(storageSectionExtension.properties.title).toBe('Storage');
      expect(storageSectionExtension.properties.section).toBe('brewet');
    });
  });

  describe('navigation extensions', () => {
    it('should define Storage Browser nav item under storage section', () => {
      expect(storageBrowserNavExtension.type).toBe('app.navigation/href');
      expect(storageBrowserNavExtension.properties.id).toBe('brewet-storage-browser');
      expect(storageBrowserNavExtension.properties.title).toBe('Storage Browser');
      expect(storageBrowserNavExtension.properties.href).toBe('/brewet/storage/browse');
      expect(storageBrowserNavExtension.properties.section).toBe('brewet-storage');
      expect(storageBrowserNavExtension.properties.path).toBe('/brewet/storage/browse/*');
    });

    it('should define Storage Management nav item under storage section', () => {
      expect(storageManagementNavExtension.type).toBe('app.navigation/href');
      expect(storageManagementNavExtension.properties.id).toBe('brewet-storage-management');
      expect(storageManagementNavExtension.properties.title).toBe('Storage Management');
      expect(storageManagementNavExtension.properties.href).toBe('/brewet/storage/manage');
      expect(storageManagementNavExtension.properties.section).toBe('brewet-storage');
      expect(storageManagementNavExtension.properties.path).toBe('/brewet/storage/manage/*');
    });

    it('should define Settings nav item under brewet section', () => {
      expect(settingsNavExtension.type).toBe('app.navigation/href');
      expect(settingsNavExtension.properties.id).toBe('brewet-settings');
      expect(settingsNavExtension.properties.title).toBe('Settings');
      expect(settingsNavExtension.properties.href).toBe('/brewet/settings');
      expect(settingsNavExtension.properties.section).toBe('brewet');
      expect(settingsNavExtension.properties.path).toBe('/brewet/settings/*');
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
    it('should contain all eight extensions', () => {
      expect(extensions).toHaveLength(8);
    });

    it('should include all extensions in the correct order', () => {
      expect(extensions).toEqual([
        communityPluginsSectionExtension,
        brewetAreaExtension,
        brewetSectionExtension,
        storageSectionExtension,
        storageBrowserNavExtension,
        storageManagementNavExtension,
        settingsNavExtension,
        brewetRouteExtension,
      ]);
    });
  });
});
