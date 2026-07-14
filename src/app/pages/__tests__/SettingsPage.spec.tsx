import { render, screen } from '@testing-library/react';
import SettingsPage from '../SettingsPage';

describe('SettingsPage', () => {
  it('should render the page title', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should render the coming soon placeholder', () => {
    render(<SettingsPage />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
