import React, { useState, useEffect, useRef } from 'react';
import {
  PageSection,
  Title,
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
} from '@patternfly/react-core';
import { EyeIcon, EyeSlashIcon } from '@patternfly/react-icons';
import { useBrewetContext } from '~/app/context/BrewetContext';
import { ContainerRequired } from '~/app/components/ContainerRequired';
import { storageService } from '~/app/services/storageService';
import type { S3Settings, HuggingFaceSettings, ProxySettings } from '~/app/types/storage';

type TabKey = 's3' | 'huggingface' | 'proxy' | 'transfers' | 'pagination';

interface AlertState {
  variant: 'success' | 'danger';
  title: string;
  message?: string;
}

const S3Tab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const [settings, setSettings] = useState<S3Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setAlert(null);
      try {
        const s = await storageService.getS3Settings(namespace, controller.signal);
        if (!mountedRef.current) return;
        setSettings(s);
      } catch (err) {
        if (!mountedRef.current || (err as Error).name === 'AbortError') return;
        setAlert({ variant: 'danger', title: 'Failed to load S3 settings', message: (err as Error).message });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [namespace]);

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
    </Form>
  );
};

const HuggingFaceTab: React.FC<{ namespace: string }> = ({ namespace }) => {
  const [settings, setSettings] = useState<HuggingFaceSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const [showToken, setShowToken] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setAlert(null);
      try {
        const s = await storageService.getHuggingFaceSettings(namespace, controller.signal);
        if (!mountedRef.current) return;
        setSettings(s);
      } catch (err) {
        if (!mountedRef.current || (err as Error).name === 'AbortError') return;
        setAlert({ variant: 'danger', title: 'Failed to load HuggingFace settings', message: (err as Error).message });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [namespace]);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await storageService.updateHuggingFaceSettings(namespace, settings);
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
  const [settings, setSettings] = useState<ProxySettings>({});
  const [testUrl, setTestUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setAlert(null);
      try {
        const s = await storageService.getProxySettings(namespace, controller.signal);
        if (!mountedRef.current) return;
        setSettings(s);
      } catch (err) {
        if (!mountedRef.current || (err as Error).name === 'AbortError') return;
        setAlert({ variant: 'danger', title: 'Failed to load proxy settings', message: (err as Error).message });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [namespace]);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await storageService.updateProxySettings(namespace, settings);
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
  const [value, setValue] = useState(2);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setAlert(null);
      try {
        const v = await storageService.getMaxConcurrentTransfers(namespace, controller.signal);
        if (!mountedRef.current) return;
        setValue(v);
      } catch (err) {
        if (!mountedRef.current || (err as Error).name === 'AbortError') return;
        setAlert({ variant: 'danger', title: 'Failed to load transfer settings', message: (err as Error).message });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [namespace]);

  const handleSave = async (newValue: number) => {
    setSaving(true);
    setAlert(null);
    try {
      await storageService.updateMaxConcurrentTransfers(namespace, newValue);
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
  const [value, setValue] = useState(100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setAlert(null);
      try {
        const v = await storageService.getMaxFilesPerPage(namespace, controller.signal);
        if (!mountedRef.current) return;
        setValue(v);
      } catch (err) {
        if (!mountedRef.current || (err as Error).name === 'AbortError') return;
        setAlert({ variant: 'danger', title: 'Failed to load pagination settings', message: (err as Error).message });
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [namespace]);

  const handleSave = async () => {
    setSaving(true);
    setAlert(null);
    try {
      await storageService.updateMaxFilesPerPage(namespace, value);
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
    </Tabs>
  );
};

const SettingsPage: React.FC = () => (
  <PageSection>
    <Title headingLevel="h1" size="lg">
      Settings
    </Title>
    <ContainerRequired>
      <SettingsContent />
    </ContainerRequired>
  </PageSection>
);

export default SettingsPage;
