import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateProjectModal } from '../CreateProjectModal';

describe('CreateProjectModal', () => {
  const onClose = jest.fn();
  const onCreated = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete (global as Record<string, unknown>).fetch;
  });

  function renderModal() {
    return render(
      <CreateProjectModal isOpen onClose={onClose} onCreated={onCreated} />,
    );
  }

  it('renders title and form fields', () => {
    renderModal();
    expect(screen.getByText('Create project')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^name/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByText('Edit resource name')).toBeInTheDocument();
  });

  it('does not show resource name field by default', () => {
    renderModal();
    expect(screen.queryByRole('textbox', { name: /resource name/i })).not.toBeInTheDocument();
  });

  it('shows resource name field when "Edit resource name" is clicked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByText('Edit resource name'));
    expect(screen.getByRole('textbox', { name: /resource name/i })).toBeInTheDocument();
  });

  it('auto-generates resource name from display name', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'My Project');
    await user.click(screen.getByText('Edit resource name'));
    expect(screen.getByRole('textbox', { name: /resource name/i })).toHaveValue('my-project');
  });

  it('disables Create button when name is empty', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('enables Create button when valid name is entered', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'my-project');
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
  });

  it('uses auto-generated resource name for the API call and labels the namespace', async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    renderModal();
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'My App');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('my-app');
    });

    const createBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(createBody.metadata.name).toBe('my-app');
    expect(createBody.displayName).toBe('My App');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/k8s/api/v1/namespaces/my-app',
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
      }),
    );
    const patchBody = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
    expect(patchBody.metadata.labels).toEqual({ 'opendatahub.io/dashboard': 'true' });
  });

  it('uses manually edited resource name when overridden', async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    renderModal();
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'My App');
    await user.click(screen.getByText('Edit resource name'));
    const resourceInput = screen.getByRole('textbox', { name: /resource name/i });
    await user.clear(resourceInput);
    await user.type(resourceInput, 'custom-name');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('custom-name');
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.metadata.name).toBe('custom-name');
    expect(body.displayName).toBe('My App');
  });

  it('sends description when provided', async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    renderModal();
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'test-proj');
    await user.type(screen.getByLabelText(/description/i), 'A description');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith('test-proj');
    });

    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.description).toBe('A description');
  });

  it('shows error alert on API failure', async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ message: 'already exists' }),
    });

    renderModal();
    await user.type(screen.getByRole('textbox', { name: /^name/i }), 'existing');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(screen.getByText('already exists')).toBeInTheDocument();
    });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});
