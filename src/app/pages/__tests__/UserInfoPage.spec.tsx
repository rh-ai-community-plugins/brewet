import { render, screen } from '@testing-library/react';
import { useCurrentUser } from '~/app/hooks/useCurrentUser';
import UserInfoPage from '../UserInfoPage';

jest.mock('~/app/hooks/useCurrentUser');

const mockUser = {
  userName: 'test-user',
  userID: 'uid-123',
  isAdmin: false,
  clusterID: 'cluster-abc',
  clusterBranding: 'ocp',
  namespace: 'default',
  currentContext: 'ctx',
  currentUser: 'test-user',
  isAllowed: true,
  serverURL: 'https://api.cluster.example.com:6443',
};

describe('UserInfoPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('shows loading spinner while user data loads', () => {
    (useCurrentUser as jest.Mock).mockReturnValue({
      user: null,
      loading: true,
      error: null,
    });

    render(<UserInfoPage />);

    expect(screen.getByLabelText('Loading user information')).toBeInTheDocument();
  });

  it('shows error alert when user fetch fails', () => {
    (useCurrentUser as jest.Mock).mockReturnValue({
      user: null,
      loading: false,
      error: 'Failed to fetch status: 403',
    });

    render(<UserInfoPage />);

    expect(screen.getByText('Failed to load user information')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch status: 403')).toBeInTheDocument();
  });

  it('displays user information when loaded', () => {
    (useCurrentUser as jest.Mock).mockReturnValue({
      user: mockUser,
      loading: false,
      error: null,
    });

    render(<UserInfoPage />);

    expect(screen.getByText('test-user')).toBeInTheDocument();
    expect(screen.getByText('uid-123')).toBeInTheDocument();
    expect(screen.getByText('cluster-abc')).toBeInTheDocument();
    expect(screen.getByText('ocp')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('hides admin-only section for non-admin users', () => {
    (useCurrentUser as jest.Mock).mockReturnValue({
      user: mockUser,
      loading: false,
      error: null,
    });

    render(<UserInfoPage />);

    expect(screen.queryByText('Admin-Only Section')).not.toBeInTheDocument();
  });

  it('shows admin-only section for admin users', () => {
    (useCurrentUser as jest.Mock).mockReturnValue({
      user: { ...mockUser, isAdmin: true },
      loading: false,
      error: null,
    });

    render(<UserInfoPage />);

    expect(screen.getByText('Admin-Only Section')).toBeInTheDocument();
    expect(
      screen.getByText('If you can see this section, you are logged in as a RHOAI admin.'),
    ).toBeInTheDocument();
  });
});
