import React, { useState } from 'react';
import {
  PageSection,
  Tabs,
  Tab,
  TabTitleText,
  Form,
  FormGroup,
  TextInput,
  Button,
  Alert,
  AlertActionCloseButton,
  Spinner,
  Bullseye,
  ActionGroup,
  Slider,
  InputGroup,
  InputGroupItem,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ClipboardCopy,
} from '@patternfly/react-core';
import { EyeIcon, EyeSlashIcon } from '@patternfly/react-icons';
import { HelperText, HelperTextItem } from '@patternfly/react-core';
import { InfoIcon } from '@patternfly/react-icons';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { ContainerRequired } from '~/app/components/ContainerRequired';
import { storageService } from '~/app/services/storageService';
import { useSettingsTab } from '~/app/hooks/useSettingsTab';
import type { S3Settings, HuggingFaceSettings, ProxySettings, FileExtensionSettings } from '~/app/types/storage';

type TabKey = 's3' | 'huggingface' | 'proxy' | 'transfers' | 'pagination' | 'filetypes';

const S3Tab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const { data: settings, setData: setSettings, loading, alert, setAlert, mountedRef } =
    useSettingsTab<S3Settings>(
      (ns, signal) => storageService.getS3Settings(ns, signal),
      namespace, {}, 'Failed to load S3 settings',
    );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await storageService.updateS3Settings(namespace, settings);
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'S3 settings saved successfully' });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Failed to save S3 settings', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setAlert(null);
    try {
      const result = await storageService.testS3Connection(namespace, {
        accessKeyId: settings.accessKeyId || '',
        secretAccessKey: settings.secretAccessKey || '',
        region: settings.region || '',
        endpoint: settings.endpoint || '',
      });
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'S3 connection successful', message: result.message });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'S3 connection failed', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setTesting(false);
    }
  };

  const updateField = (field: keyof S3Settings, value: string) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  if (loading) {
    return <Bullseye><Spinner aria-label="Loading S3 settings" /></Bullseye>;
  }

  return (
    <Form>
      {alert && (
        <Alert variant={alert.variant} title={alert.title} isInline actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}>
          {alert.message}
        </Alert>
      )}
      <FormGroup label="Endpoint URL" isRequired fieldId="s3-endpoint">
        <TextInput id="s3-endpoint" value={settings.endpoint || ''} onChange={(_e, v) => updateField('endpoint', v)} />
      </FormGroup>
      <FormGroup label="Access Key ID" isRequired fieldId="s3-access-key">
        <TextInput id="s3-access-key" value={settings.accessKeyId || ''} onChange={(_e, v) => updateField('accessKeyId', v)} />
      </FormGroup>
      <FormGroup label="Secret Access Key" isRequired fieldId="s3-secret-key">
        <InputGroup>
          <InputGroupItem isFill>
            <TextInput
              id="s3-secret-key"
              type={showSecret ? 'text' : 'password'}
              value={settings.secretAccessKey || ''}
              onChange={(_e, v) => updateField('secretAccessKey', v)}
            />
          </InputGroupItem>
          <InputGroupItem>
            <Button
              variant="control"
              onClick={() => setShowSecret(!showSecret)}
              aria-label={showSecret ? 'Hide secret' : 'Show secret'}
            >
              {showSecret ? <EyeSlashIcon /> : <EyeIcon />}
            </Button>
          </InputGroupItem>
        </InputGroup>
      </FormGroup>
      <FormGroup label="Region" isRequired fieldId="s3-region">
        <TextInput id="s3-region" value={settings.region || ''} onChange={(_e, v) => updateField('region', v)} />
      </FormGroup>
      <FormGroup label="Default Bucket" fieldId="s3-default-bucket">
        <TextInput id="s3-default-bucket" value={settings.defaultBucket || ''} onChange={(_e, v) => updateField('defaultBucket', v)} />
      </FormGroup>
      <ActionGroup>
        <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving || testing}>
          Save
        </Button>
        <Button variant="secondary" onClick={handleTest} isLoading={testing} isDisabled={saving || testing}>
          Test Connection
        </Button>
      </ActionGroup>
      <HelperText>
        <HelperTextItem icon={<InfoIcon />}>
          S3 settings are loaded from your Data Connection and stored in-memory only. Changes here apply
          until Brewet restarts. To change them permanently, update the Data Connection in the
          RHOAI dashboard.
        </HelperTextItem>
      </HelperText>
    </Form>
  );
};

const HuggingFaceTab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const { data: settings, setData: setSettings, loading, alert, setAlert, mountedRef } =
    useSettingsTab<HuggingFaceSettings>(
      async (ns, signal) => {
        const s = await storageService.readSettingsSecret(ns, signal);
        return { hfToken: s.hfToken ?? '' };
      },
      namespace, {}, 'Failed to load HuggingFace settings',
    );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await Promise.all([
        storageService.patchSettingsSecret(namespace, { HF_TOKEN: settings.hfToken ?? '' }),
        storageService.updateHuggingFaceSettings(namespace, settings),
      ]);
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'HuggingFace settings saved successfully' });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Failed to save HuggingFace settings', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setAlert(null);
    try {
      const result = await storageService.testHuggingFaceConnection(namespace, {
        hfToken: settings.hfToken || '',
      });
      if (!mountedRef.current) return;
      const msg = result.accessTokenDisplayName
        ? `${result.message} (Token: ${result.accessTokenDisplayName})`
        : result.message;
      setAlert({ variant: 'success', title: 'HuggingFace connection successful', message: msg });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'HuggingFace connection failed', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setTesting(false);
    }
  };

  if (loading) {
    return <Bullseye><Spinner aria-label="Loading HuggingFace settings" /></Bullseye>;
  }

  return (
    <Form>
      {alert && (
        <Alert variant={alert.variant} title={alert.title} isInline actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}>
          {alert.message}
        </Alert>
      )}
      <FormGroup label="API Token" isRequired fieldId="hf-token">
        <InputGroup>
          <InputGroupItem isFill>
            <TextInput
              id="hf-token"
              type={showToken ? 'text' : 'password'}
              value={settings.hfToken || ''}
              onChange={(_e, v) => setSettings({ hfToken: v })}
            />
          </InputGroupItem>
          <InputGroupItem>
            <Button
              variant="control"
              onClick={() => setShowToken(!showToken)}
              aria-label={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeSlashIcon /> : <EyeIcon />}
            </Button>
          </InputGroupItem>
        </InputGroup>
      </FormGroup>
      <ActionGroup>
        <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving || testing}>
          Save
        </Button>
        <Button variant="secondary" onClick={handleTest} isLoading={testing} isDisabled={saving || testing}>
          Test Connection
        </Button>
      </ActionGroup>
    </Form>
  );
};

const ProxyTab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const { data: settings, setData: setSettings, loading, alert, setAlert, mountedRef } =
    useSettingsTab<ProxySettings>(
      async (ns, signal) => {
        const s = await storageService.readSettingsSecret(ns, signal);
        return { httpProxy: s.httpProxy ?? '', httpsProxy: s.httpsProxy ?? '' };
      },
      namespace, {}, 'Failed to load proxy settings',
    );
  const [testUrl, setTestUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await Promise.all([
        storageService.patchSettingsSecret(namespace, {
          HTTP_PROXY: settings.httpProxy ?? '',
          HTTPS_PROXY: settings.httpsProxy ?? '',
        }),
        storageService.updateProxySettings(namespace, settings),
      ]);
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'Proxy settings saved successfully' });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Failed to save proxy settings', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testUrl) {
      setAlert({ variant: 'danger', title: 'Test URL is required' });
      return;
    }
    try {
      new URL(testUrl);
    } catch {
      setAlert({ variant: 'danger', title: 'Invalid URL format', message: 'Please enter a valid URL (e.g., https://example.com)' });
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const result = await storageService.testProxyConnection(namespace, {
        testUrl,
        httpProxy: settings.httpProxy,
        httpsProxy: settings.httpsProxy,
      });
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'Proxy connection successful', message: result.message });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Proxy connection failed', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setTesting(false);
    }
  };

  if (loading) {
    return <Bullseye><Spinner aria-label="Loading proxy settings" /></Bullseye>;
  }

  return (
    <Form>
      {alert && (
        <Alert variant={alert.variant} title={alert.title} isInline actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}>
          {alert.message}
        </Alert>
      )}
      <FormGroup label="HTTP Proxy" fieldId="proxy-http">
        <TextInput
          id="proxy-http"
          value={settings.httpProxy || ''}
          onChange={(_e, v) => setSettings((prev) => ({ ...prev, httpProxy: v }))}
          placeholder="http://proxy:8080"
        />
      </FormGroup>
      <FormGroup label="HTTPS Proxy" fieldId="proxy-https">
        <TextInput
          id="proxy-https"
          value={settings.httpsProxy || ''}
          onChange={(_e, v) => setSettings((prev) => ({ ...prev, httpsProxy: v }))}
          placeholder="https://proxy:8443"
        />
      </FormGroup>
      <FormGroup label="Test URL" fieldId="proxy-test-url">
        <TextInput
          id="proxy-test-url"
          value={testUrl}
          onChange={(_e, v) => setTestUrl(v)}
          placeholder="https://example.com"
        />
      </FormGroup>
      <ActionGroup>
        <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving || testing}>
          Save
        </Button>
        <Button variant="secondary" onClick={handleTest} isLoading={testing} isDisabled={saving || testing}>
          Test Connection
        </Button>
      </ActionGroup>
    </Form>
  );
};

const TransferControlsTab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const { data: value, setData: setValue, loading, alert, setAlert, mountedRef } =
    useSettingsTab<number>(
      async (ns, signal) => {
        const s = await storageService.readSettingsSecret(ns, signal);
        return s.maxConcurrentTransfers ?? 2;
      },
      namespace, 2, 'Failed to load transfer settings',
    );
  const [saving, setSaving] = useState(false);

  const handleSave = async (newValue: number) => {
    setSaving(true);
    setAlert(null);
    try {
      await Promise.all([
        storageService.patchSettingsSecret(namespace, {
          MAX_CONCURRENT_TRANSFERS: String(newValue),
        }),
        storageService.updateMaxConcurrentTransfers(namespace, newValue),
      ]);
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'Transfer concurrency updated' });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Failed to update transfer concurrency', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  if (loading) {
    return <Bullseye><Spinner aria-label="Loading transfer settings" /></Bullseye>;
  }

  return (
    <Form>
      {alert && (
        <Alert variant={alert.variant} title={alert.title} isInline actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}>
          {alert.message}
        </Alert>
      )}
      <FormGroup label="Max concurrent transfers" fieldId="max-transfers">
        <Slider
          id="max-transfers"
          value={value}
          min={1}
          max={20}
          step={1}
          showBoundaries
          showTicks
          isInputVisible
          inputValue={value}
          inputLabel=""
          onChange={(_e, val) => setValue(val)}
        />
      </FormGroup>
      <ActionGroup>
        <Button
          variant="primary"
          onClick={() => handleSave(value)}
          isLoading={saving}
          isDisabled={saving}
        >
          Save
        </Button>
      </ActionGroup>
    </Form>
  );
};

const PaginationTab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const { data: value, setData: setValue, loading, alert, setAlert, mountedRef } =
    useSettingsTab<number>(
      async (ns, signal) => {
        const s = await storageService.readSettingsSecret(ns, signal);
        return s.maxFilesPerPage ?? 100;
      },
      namespace, 100, 'Failed to load pagination settings',
    );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await Promise.all([
        storageService.patchSettingsSecret(namespace, {
          MAX_FILES_PER_PAGE: String(value),
        }),
        storageService.updateMaxFilesPerPage(namespace, value),
      ]);
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'Pagination settings updated' });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Failed to update pagination settings', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  if (loading) {
    return <Bullseye><Spinner aria-label="Loading pagination settings" /></Bullseye>;
  }

  return (
    <Form>
      {alert && (
        <Alert variant={alert.variant} title={alert.title} isInline actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}>
          {alert.message}
        </Alert>
      )}
      <FormGroup label="Max files per page" fieldId="max-files">
        <Slider
          id="max-files"
          value={value}
          min={10}
          max={1000}
          step={10}
          showBoundaries
          isInputVisible
          inputValue={value}
          inputLabel=""
          onChange={(_e, val) => setValue(val)}
        />
      </FormGroup>
      <ActionGroup>
        <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving}>
          Save
        </Button>
      </ActionGroup>
    </Form>
  );
};

const DEFAULT_ALLOWED = '.safetensors, .bin, .pt, .pth, .onnx, .gguf, .h5, .csv, .json, .jsonl, .parquet, .arrow, .feather, .txt, .md, .yaml, .yml, .tar, .gz, .zip, .tgz, .jpg, .jpeg, .png, .gif, .bmp, .wav, .mp3, .mp4, .avi, .ipynb, .py, .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx, .odt, .ods, .odp, .rtf, .xml, .html, .css, .old, .bak, .backup, .tmp, .log, .sql';

const DEFAULT_BLOCKED = '.exe, .dll, .so, .dylib, .sh, .bat, .cmd, .com, .js, .ts, .rb, .pl, .php, .sys, .drv';

const FileTypesTab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const { data: settings, setData: setSettings, loading, alert, setAlert, mountedRef } =
    useSettingsTab<FileExtensionSettings>(
      async (ns, signal) => {
        const s = await storageService.readSettingsSecret(ns, signal);
        return {
          allowedExtensions: s.allowedFileExtensions ?? '',
          blockedExtensions: s.blockedFileExtensions ?? '',
        };
      },
      namespace,
      { allowedExtensions: '', blockedExtensions: '' },
      'Failed to load file type settings',
    );
  const [saving, setSaving] = useState(false);
  const [defaultsModal, setDefaultsModal] = useState<'allowed' | 'blocked' | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      const allowedList = (settings.allowedExtensions || '')
        .split(',').map((e) => e.trim()).filter(Boolean);
      const blockedList = (settings.blockedExtensions || '')
        .split(',').map((e) => e.trim()).filter(Boolean);

      await Promise.all([
        storageService.patchSettingsSecret(namespace, {
          ALLOWED_FILE_EXTENSIONS: settings.allowedExtensions ?? '',
          BLOCKED_FILE_EXTENSIONS: settings.blockedExtensions ?? '',
        }),
        storageService.updateFileExtensions(namespace, {
          allowedExtensions: allowedList,
          blockedExtensions: blockedList,
        }),
      ]);
      if (!mountedRef.current) return;
      setAlert({ variant: 'success', title: 'File type settings saved successfully' });
    } catch (err) {
      if (!mountedRef.current) return;
      setAlert({ variant: 'danger', title: 'Failed to save file type settings', message: (err as Error).message });
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  };

  if (loading) {
    return <Bullseye><Spinner aria-label="Loading file type settings" /></Bullseye>;
  }

  return (
    <Form>
      {alert && (
        <Alert variant={alert.variant} title={alert.title} isInline actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}>
          {alert.message}
        </Alert>
      )}
      <FormGroup
        label={
          <span>
            Allowed file extensions{' '}
            <Button variant="link" isInline onClick={() => setDefaultsModal('allowed')}>(defaults)</Button>
          </span>
        }
        fieldId="allowed-extensions"
      >
        <TextInput
          id="allowed-extensions"
          value={settings.allowedExtensions || ''}
          onChange={(_e, v) => setSettings((prev) => ({ ...prev, allowedExtensions: v }))}
          placeholder=".safetensors, .bin, .pt, .csv, .json, .py, ..."
        />
      </FormGroup>
      <FormGroup
        label={
          <span>
            Blocked file extensions{' '}
            <Button variant="link" isInline onClick={() => setDefaultsModal('blocked')}>(defaults)</Button>
          </span>
        }
        fieldId="blocked-extensions"
      >
        <TextInput
          id="blocked-extensions"
          value={settings.blockedExtensions || ''}
          onChange={(_e, v) => setSettings((prev) => ({ ...prev, blockedExtensions: v }))}
          placeholder=".exe, .dll, .sh, .bat, ..."
        />
      </FormGroup>
      <ActionGroup>
        <Button variant="primary" onClick={handleSave} isLoading={saving} isDisabled={saving}>
          Save
        </Button>
      </ActionGroup>
      <HelperText>
        <HelperTextItem icon={<InfoIcon />}>
          Comma-separated lists of file extensions. Wildcards are supported: .p* matches .py, .pl,
          .php; * matches any extension. Setting a value fully replaces the built-in defaults — include
          all extensions you want. Leave empty to use the defaults.
        </HelperTextItem>
      </HelperText>
      <Modal
        isOpen={defaultsModal !== null}
        onClose={() => setDefaultsModal(null)}
        aria-label="Default extensions"
        variant="medium"
      >
        <ModalHeader
          title={defaultsModal === 'allowed' ? 'Default allowed extensions' : 'Default blocked extensions'}
        />
        <ModalBody>
          <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied" variant="expansion">
            {defaultsModal === 'allowed' ? DEFAULT_ALLOWED : DEFAULT_BLOCKED}
          </ClipboardCopy>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" onClick={() => setDefaultsModal(null)}>Close</Button>
        </ModalFooter>
      </Modal>
    </Form>
  );
};

const SettingsContent: React.FC = () => {
  const { selectedProject } = useBrewetContext();
  const [activeTab, setActiveTab] = useState<TabKey>('s3');

  if (!selectedProject) return null;

  return (
    <Tabs
      activeKey={activeTab}
      onSelect={(_e, key) => setActiveTab(key as TabKey)}
      aria-label="Settings tabs"
    >
      <Tab eventKey="s3" title={<TabTitleText>S3 Storage</TabTitleText>} aria-label="S3 Storage settings">
        <div className="pf-v6-u-pt-lg">
          <S3Tab namespace={selectedProject} />
        </div>
      </Tab>
      <Tab eventKey="huggingface" title={<TabTitleText>HuggingFace</TabTitleText>} aria-label="HuggingFace settings">
        <div className="pf-v6-u-pt-lg">
          <HuggingFaceTab namespace={selectedProject} />
        </div>
      </Tab>
      <Tab eventKey="proxy" title={<TabTitleText>Proxy</TabTitleText>} aria-label="Proxy settings">
        <div className="pf-v6-u-pt-lg">
          <ProxyTab namespace={selectedProject} />
        </div>
      </Tab>
      <Tab eventKey="transfers" title={<TabTitleText>Transfer Controls</TabTitleText>} aria-label="Transfer Controls settings">
        <div className="pf-v6-u-pt-lg">
          <TransferControlsTab namespace={selectedProject} />
        </div>
      </Tab>
      <Tab eventKey="pagination" title={<TabTitleText>Pagination</TabTitleText>} aria-label="Pagination settings">
        <div className="pf-v6-u-pt-lg">
          <PaginationTab namespace={selectedProject} />
        </div>
      </Tab>
      <Tab eventKey="filetypes" title={<TabTitleText>File Types</TabTitleText>} aria-label="File Types settings">
        <div className="pf-v6-u-pt-lg">
          <FileTypesTab namespace={selectedProject} />
        </div>
      </Tab>
    </Tabs>
  );
};

const SettingsPage: React.FC = () => (
  <PageSection padding={{ default: 'noPadding' }} className="pf-v6-u-px-lg pf-v6-u-pb-md">
    <ContainerRequired>
      <SettingsContent />
    </ContainerRequired>
  </PageSection>
);

export default SettingsPage;
