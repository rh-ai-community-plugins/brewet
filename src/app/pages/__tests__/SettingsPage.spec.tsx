import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsPage from '../SettingsPage';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { useBrewetContainer } from '~/app/hooks/useBrewetContainer';
import { storageService } from '~/app/services/storageService';

jest.mock('~/app/context/BrewetContext');
jest.mock('~/app/hooks/useBrewetContainer');
jest.mock('~/app/services/storageService');

jest.mock('~/app/components/ContainerWizard', () => ({
  ContainerWizard: () => null,
}));

const mockUseBrewetContext = useBrewetContext as jest.MockedFunction<typeof useBrewetContext>;
const mockUseBrewetContainer = useBrewetContainer as jest.MockedFunction<typeof useBrewetContainer>;
const mockStorageService = storageService as jest.Mocked<typeof storageService>;

function setupMocks() {
  mockUseBrewetContext.mockReturnValue({
    selectedProject: 'test-ns',
    setSelectedProject: jest.fn(),
    projects: [],
    projectsLoading: false,
    projectsError: null,
    refreshProjects: jest.fn(),
    addProject: jest.fn(),
    containerStatus: 'running',
    containerInfo: null,
    refreshContainerStatus: jest.fn(),
    isActioning: false,
    setIsActioning: jest.fn(),
  });
  mockUseBrewetContainer.mockReturnValue({
    selectedProject: 'test-ns',
    containerStatus: 'running',
    containerInfo: null,
    isActioning: false,
    startContainer: jest.fn(),
    stopContainer: jest.fn(),
    deleteContainer: jest.fn().mockResolvedValue(undefined),
    createContainer: jest.fn().mockResolvedValue([]),
    updateContainer: jest.fn().mockResolvedValue([]),
    refreshContainerStatus: jest.fn(),
  });

  mockStorageService.getS3Settings.mockResolvedValue({
    endpoint: 'https://s3.example.com',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    defaultBucket: 'my-bucket',
  });
  mockStorageService.readSettingsSecret.mockResolvedValue({
    hfToken: 'hf_testtoken123',
    httpProxy: '',
    httpsProxy: '',
    maxConcurrentTransfers: 2,
    maxFilesPerPage: 100,
  });
  mockStorageService.patchSettingsSecret.mockResolvedValue(undefined);

  mockStorageService.updateS3Settings.mockResolvedValue(undefined);
  mockStorageService.updateHuggingFaceSettings.mockResolvedValue(undefined);
  mockStorageService.updateProxySettings.mockResolvedValue(undefined);
  mockStorageService.updateMaxConcurrentTransfers.mockResolvedValue(undefined);
  mockStorageService.updateMaxFilesPerPage.mockResolvedValue(undefined);

  mockStorageService.testS3Connection.mockResolvedValue({ message: 'Connection successful' });
  mockStorageService.testHuggingFaceConnection.mockResolvedValue({
    message: 'Connection successful',
    accessTokenDisplayName: 'my-token',
  });
  mockStorageService.testProxyConnection.mockResolvedValue({ message: 'Connection successful' });
}

async function renderSettingsPage() {
  render(<SettingsPage />);
  await waitFor(() => {
    expect(screen.getByDisplayValue('https://s3.example.com')).toBeInTheDocument();
  });
}

describe('SettingsPage', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    setupMocks();
  });

  it('should render page content', async () => {
    await renderSettingsPage();
    expect(screen.getByRole('tab', { name: /S3 Storage/i })).toBeInTheDocument();
  });

  it('should render all five tabs', async () => {
    await renderSettingsPage();
    expect(screen.getByRole('tab', { name: /S3 Storage/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /HuggingFace/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Proxy/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Transfer Controls/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pagination/i })).toBeInTheDocument();
  });

  describe('S3 Storage tab', () => {
    it('should load and display S3 settings', async () => {
      await renderSettingsPage();
      expect(screen.getByDisplayValue('AKIAIOSFODNN7EXAMPLE')).toBeInTheDocument();
      expect(screen.getByDisplayValue('us-east-1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('my-bucket')).toBeInTheDocument();
      expect(mockStorageService.getS3Settings).toHaveBeenCalledWith('test-ns', expect.any(AbortSignal));
    });

    it('should save S3 settings', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      const saveButtons = screen.getAllByRole('button', { name: /^Save$/i });
      await user.click(saveButtons[0]);

      await waitFor(() => {
        expect(mockStorageService.updateS3Settings).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ endpoint: 'https://s3.example.com' }),
        );
      });
      expect(screen.getByText('S3 settings saved successfully')).toBeInTheDocument();
    });

    it('should test S3 connection', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      const testButton = screen.getByRole('button', { name: /Test Connection/i });
      await user.click(testButton);

      await waitFor(() => {
        expect(mockStorageService.testS3Connection).toHaveBeenCalledWith(
          'test-ns',
          {
            endpoint: 'https://s3.example.com',
            accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
            secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            region: 'us-east-1',
          },
        );
      });
      expect(screen.getByText('S3 connection successful')).toBeInTheDocument();
    });

    it('should show error alert on S3 test failure', async () => {
      mockStorageService.testS3Connection.mockRejectedValue(new Error('Connection refused'));
      const user = userEvent.setup();
      await renderSettingsPage();

      const testButton = screen.getByRole('button', { name: /Test Connection/i });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByText('S3 connection failed')).toBeInTheDocument();
      });
      expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });

    it('should show error when S3 settings fail to load', async () => {
      mockStorageService.getS3Settings.mockRejectedValue(new Error('Network error'));
      render(<SettingsPage />);
      await waitFor(() => {
        expect(screen.getByText('Failed to load S3 settings')).toBeInTheDocument();
      });
    });
  });

  describe('HuggingFace tab', () => {
    it('should load and display HuggingFace settings from secret', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /HuggingFace/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('hf_testtoken123')).toBeInTheDocument();
      });
      expect(mockStorageService.readSettingsSecret).toHaveBeenCalledWith('test-ns', expect.any(AbortSignal));
    });

    it('should test HuggingFace connection and show token name', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /HuggingFace/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('hf_testtoken123')).toBeInTheDocument();
      });

      const testButton = screen.getByRole('button', { name: /Test Connection/i });
      await user.click(testButton);

      await waitFor(() => {
        expect(screen.getByText('HuggingFace connection successful')).toBeInTheDocument();
      });
      expect(screen.getByText(/my-token/)).toBeInTheDocument();
    });

    it('should dual-write HuggingFace settings to secret and backend', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /HuggingFace/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('hf_testtoken123')).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /^Save$/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockStorageService.patchSettingsSecret).toHaveBeenCalledWith(
          'test-ns',
          { HF_TOKEN: 'hf_testtoken123' },
        );
        expect(mockStorageService.updateHuggingFaceSettings).toHaveBeenCalledWith(
          'test-ns',
          { hfToken: 'hf_testtoken123' },
        );
      });
    });
  });

  describe('Proxy tab', () => {
    it('should load and display proxy settings from secret', async () => {
      mockStorageService.readSettingsSecret.mockResolvedValue({
        hfToken: '',
        httpProxy: 'http://proxy:8080',
        httpsProxy: 'https://proxy:8443',
        maxConcurrentTransfers: 2,
        maxFilesPerPage: 100,
      });
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /^Proxy/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('http://proxy:8080')).toBeInTheDocument();
      });
      expect(screen.getByDisplayValue('https://proxy:8443')).toBeInTheDocument();
    });


    it('should test proxy connection', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /^Proxy/i }));
      await waitFor(() => {
        expect(screen.getByLabelText('Test URL')).toBeInTheDocument();
      });

      const testUrlInput = screen.getByLabelText('Test URL');
      await user.type(testUrlInput, 'https://example.com');

      const testButton = screen.getByRole('button', { name: /Test Connection/i });
      await user.click(testButton);

      await waitFor(() => {
        expect(mockStorageService.testProxyConnection).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ testUrl: 'https://example.com' }),
        );
      });
      expect(screen.getByText('Proxy connection successful')).toBeInTheDocument();
    });

    it('should require test URL for proxy test', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /^Proxy/i }));
      await waitFor(() => {
        expect(screen.getByLabelText('Test URL')).toBeInTheDocument();
      });

      const testButton = screen.getByRole('button', { name: /Test Connection/i });
      await user.click(testButton);

      expect(screen.getByText('Test URL is required')).toBeInTheDocument();
      expect(mockStorageService.testProxyConnection).not.toHaveBeenCalled();
    });

    it('should reject invalid URL format for proxy test', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /^Proxy/i }));
      await waitFor(() => {
        expect(screen.getByLabelText('Test URL')).toBeInTheDocument();
      });

      const testUrlInput = screen.getByLabelText('Test URL');
      await user.type(testUrlInput, 'not-a-url');

      const testButton = screen.getByRole('button', { name: /Test Connection/i });
      await user.click(testButton);

      expect(screen.getByText('Invalid URL format')).toBeInTheDocument();
      expect(mockStorageService.testProxyConnection).not.toHaveBeenCalled();
    });

    it('should dual-write proxy settings to secret and backend', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /^Proxy/i }));
      await waitFor(() => {
        expect(screen.getByLabelText('HTTP Proxy')).toBeInTheDocument();
      });

      const httpInput = screen.getByLabelText('HTTP Proxy');
      await user.type(httpInput, 'http://proxy:3128');

      const saveButton = screen.getByRole('button', { name: /^Save$/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockStorageService.patchSettingsSecret).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ HTTP_PROXY: 'http://proxy:3128' }),
        );
        expect(mockStorageService.updateProxySettings).toHaveBeenCalledWith(
          'test-ns',
          expect.objectContaining({ httpProxy: 'http://proxy:3128' }),
        );
      });
    });
  });

  describe('Transfer Controls tab', () => {
    it('should load transfer settings from secret', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /Transfer Controls/i }));
      await waitFor(() => {
        expect(mockStorageService.readSettingsSecret).toHaveBeenCalledWith('test-ns', expect.any(AbortSignal));
      });
    });

    it('should dual-write transfer concurrency to secret and backend', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /Transfer Controls/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /^Save$/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockStorageService.patchSettingsSecret).toHaveBeenCalledWith(
          'test-ns',
          { MAX_CONCURRENT_TRANSFERS: '2' },
        );
        expect(mockStorageService.updateMaxConcurrentTransfers).toHaveBeenCalledWith(
          'test-ns',
          2,
        );
      });
    });
  });

  describe('Pagination tab', () => {
    it('should load pagination settings from secret', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /Pagination/i }));
      await waitFor(() => {
        expect(mockStorageService.readSettingsSecret).toHaveBeenCalledWith('test-ns', expect.any(AbortSignal));
      });
    });

    it('should dual-write pagination setting to secret and backend', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /Pagination/i }));
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
      });

      const saveButton = screen.getByRole('button', { name: /^Save$/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockStorageService.patchSettingsSecret).toHaveBeenCalledWith(
          'test-ns',
          { MAX_FILES_PER_PAGE: '100' },
        );
        expect(mockStorageService.updateMaxFilesPerPage).toHaveBeenCalledWith(
          'test-ns',
          100,
        );
      });
    });
  });

  describe('tab switching', () => {
    it('should switch between tabs', async () => {
      const user = userEvent.setup();
      await renderSettingsPage();

      await user.click(screen.getByRole('tab', { name: /HuggingFace/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('hf_testtoken123')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('tab', { name: /^Proxy/i }));
      await waitFor(() => {
        expect(screen.getByLabelText('HTTP Proxy')).toBeInTheDocument();
      });
    });
  });
});
