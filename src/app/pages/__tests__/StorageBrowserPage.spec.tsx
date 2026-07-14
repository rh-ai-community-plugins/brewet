import { render, screen } from '@testing-library/react';
import StorageBrowserPage from '../StorageBrowserPage';

describe('StorageBrowserPage', () => {
  it('should render the page title', () => {
    render(<StorageBrowserPage />);
    expect(screen.getByText('Storage Browser')).toBeInTheDocument();
  });

  it('should render the coming soon placeholder', () => {
    render(<StorageBrowserPage />);
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });
});
