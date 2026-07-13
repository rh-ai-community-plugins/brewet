import { render, screen } from '@testing-library/react';
import { useNamespaceSummary } from '~/app/hooks/useNamespaceSummary';
import NamespaceSummaryPage from '../NamespaceSummaryPage';

jest.mock('~/app/hooks/useNamespaceSummary');

const mockSummary = {
  namespaces: [
    {
      name: 'project-a',
      phase: 'Active',
      pods: { total: 3, running: 2, pending: 1, succeeded: 0, failed: 0, unknown: 0 },
    },
    {
      name: 'project-b',
      phase: 'Active',
      pods: { total: 1, running: 1, pending: 0, succeeded: 0, failed: 0, unknown: 0 },
    },
  ],
};

describe('NamespaceSummaryPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('shows loading spinner while data loads', () => {
    (useNamespaceSummary as jest.Mock).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      refresh: jest.fn(),
    });

    render(<NamespaceSummaryPage />);

    expect(screen.getByLabelText('Loading namespace summary')).toBeInTheDocument();
  });

  it('shows error alert when fetch fails', () => {
    (useNamespaceSummary as jest.Mock).mockReturnValue({
      data: null,
      loading: false,
      error: 'Failed to fetch namespace summary: 500',
      refresh: jest.fn(),
    });

    render(<NamespaceSummaryPage />);

    expect(screen.getByText('Failed to load namespace summary')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch namespace summary: 500')).toBeInTheDocument();
  });

  it('displays namespace summary when loaded', () => {
    (useNamespaceSummary as jest.Mock).mockReturnValue({
      data: mockSummary,
      loading: false,
      error: null,
      refresh: jest.fn(),
    });

    render(<NamespaceSummaryPage />);

    expect(screen.getByText('project-a')).toBeInTheDocument();
    expect(screen.getByText('project-b')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
