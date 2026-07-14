import { render, screen } from '@testing-library/react';
import App from '../App';

jest.mock('../context/BrewetContext', () => ({
  BrewetProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="brewet-provider">{children}</div>,
}));

jest.mock('../components/BrewetToolbar', () => ({
  BrewetToolbar: () => <div data-testid="brewet-toolbar" />,
}));

jest.mock('../pages/StorageBrowserPage', () => {
  const MockPage = () => <div data-testid="storage-browser-page">Storage Browser</div>;
  MockPage.displayName = 'MockStorageBrowserPage';
  return { __esModule: true, default: MockPage };
});

jest.mock('../pages/StorageManagementPage', () => {
  const MockPage = () => <div data-testid="storage-management-page">Storage Management</div>;
  MockPage.displayName = 'MockStorageManagementPage';
  return { __esModule: true, default: MockPage };
});

jest.mock('../pages/SettingsPage', () => {
  const MockPage = () => <div data-testid="settings-page">Settings</div>;
  MockPage.displayName = 'MockSettingsPage';
  return { __esModule: true, default: MockPage };
});

describe('App Component', () => {
  it('should render within BrewetProvider', () => {
    render(<App />);
    expect(screen.getByTestId('brewet-provider')).toBeInTheDocument();
  });

  it('should render the toolbar', () => {
    render(<App />);
    expect(screen.getByTestId('brewet-toolbar')).toBeInTheDocument();
  });

  it('should render the routes container', () => {
    render(<App />);
    expect(screen.getByTestId('routes')).toBeInTheDocument();
  });
});
