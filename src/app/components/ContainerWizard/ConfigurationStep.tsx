import React, { useState } from 'react';
import {
  Button,
  Content,
  Form,
  FormGroup,
  FormSection,
  InputGroup,
  InputGroupItem,
  NumberInput,
  TextInput,
} from '@patternfly/react-core';
import { EyeIcon, EyeSlashIcon } from '@patternfly/react-icons';
import type { ContainerSettings } from '~/app/types/k8s';

interface ConfigurationStepProps {
  settings: ContainerSettings;
  onChange: (settings: ContainerSettings) => void;
}

export const ConfigurationStep: React.FC<ConfigurationStepProps> = ({
  settings,
  onChange,
}) => {
  const [showToken, setShowToken] = useState(false);

  const update = (field: keyof ContainerSettings, value: string | number) => {
    onChange({ ...settings, [field]: value });
  };

  const transfers = settings.maxConcurrentTransfers ?? 2;
  const filesPerPage = settings.maxFilesPerPage ?? 100;

  return (
    <>
      <Content component="p" className="pf-v6-u-mb-md">
        Optional settings for Brewet.
        Empty fields use the backend defaults.
      </Content>
      <Form>
        <FormSection title="HuggingFace">
          <FormGroup label="API Token" fieldId="cfg-hf-token">
            <InputGroup>
              <InputGroupItem isFill>
                <TextInput
                  id="cfg-hf-token"
                  type={showToken ? 'text' : 'password'}
                  value={settings.hfToken || ''}
                  onChange={(_e, v) => update('hfToken', v)}
                  placeholder="hf_..."
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
        </FormSection>

        <FormSection title="Proxy">
          <FormGroup label="HTTP Proxy" fieldId="cfg-http-proxy">
            <TextInput
              id="cfg-http-proxy"
              value={settings.httpProxy || ''}
              onChange={(_e, v) => update('httpProxy', v)}
              placeholder="http://proxy:8080"
            />
          </FormGroup>
          <FormGroup label="HTTPS Proxy" fieldId="cfg-https-proxy">
            <TextInput
              id="cfg-https-proxy"
              value={settings.httpsProxy || ''}
              onChange={(_e, v) => update('httpsProxy', v)}
              placeholder="https://proxy:8443"
            />
          </FormGroup>
        </FormSection>

        <FormSection title="Performance">
          <FormGroup label="Max concurrent transfers" fieldId="cfg-max-transfers">
            <NumberInput
              id="cfg-max-transfers"
              value={transfers}
              min={1}
              max={20}
              onMinus={() => update('maxConcurrentTransfers', Math.max(1, transfers - 1))}
              onPlus={() => update('maxConcurrentTransfers', Math.min(20, transfers + 1))}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!isNaN(v) && v >= 1 && v <= 20) update('maxConcurrentTransfers', v);
              }}
              widthChars={4}
            />
          </FormGroup>
          <FormGroup label="Max files per page" fieldId="cfg-max-files">
            <NumberInput
              id="cfg-max-files"
              value={filesPerPage}
              min={10}
              max={1000}
              onMinus={() => update('maxFilesPerPage', Math.max(10, filesPerPage - 10))}
              onPlus={() => update('maxFilesPerPage', Math.min(1000, filesPerPage + 10))}
              onChange={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                if (!isNaN(v) && v >= 10 && v <= 1000) update('maxFilesPerPage', v);
              }}
              widthChars={6}
            />
          </FormGroup>
        </FormSection>
      </Form>
    </>
  );
};
