import { render, screen } from '@testing-library/react';
import StorageManagementPage from '../StorageManagementPage';

describe('StorageManagementPage', () => {
  it('should render the page title', () => {
    render(<StorageManagementPage />);
    expect(screen.getByText('Storage Management')).toBeInTheDocument();
  });

  it('should render the coming soon placeholder', () => {
    render(<StorageManagementPage />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
