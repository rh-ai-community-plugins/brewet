import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
  Bullseye,
  Alert,
  CodeBlock,
  CodeBlockCode,
  CodeBlockAction,
  ClipboardCopyButton,
  Content,
} from '@patternfly/react-core';
import { DownloadIcon } from '@patternfly/react-icons';
import { storageService } from '~/app/services/storageService';
import { apiClient } from '~/app/services/apiClient';
import { base64Encode } from '~/app/utils/encoding';
import type { StorageLocation, FileInfo } from '~/app/types/storage';

const TEXT_EXTENSIONS = new Set([
  'txt', 'log', 'csv', 'tsv', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'env', 'gitignore', 'dockerignore',
  'makefile', 'dockerfile',
]);

const CODE_EXTENSIONS = new Set([
  'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java',
  'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'scala',
  'r', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'xml',
  'toml',
]);

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico',
]);

type FileType = 'json' | 'yaml' | 'markdown' | 'text' | 'code' | 'image' | 'unsupported';

function getFileExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  if (lastDot === -1) return '';
  return name.slice(lastDot + 1).toLowerCase();
}

export function getFileType(name: string): FileType {
  const ext = getFileExtension(name);
  if (ext === 'json' || ext === 'jsonl' || ext === 'geojson') return 'json';
  if (ext === 'yaml' || ext === 'yml') return 'yaml';
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  const lowerName = name.toLowerCase();
  if (lowerName === 'makefile' || lowerName === 'dockerfile' || lowerName === 'jenkinsfile') return 'text';
  return 'unsupported';
}

function isPreviewable(fileType: FileType): boolean {
  return fileType !== 'unsupported';
}

function normalizeToString(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function formatJsonContent(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

interface DocumentRendererProps {
  file: FileInfo;
  namespace: string;
  location: StorageLocation;
  currentPath: string;
  onClose: () => void;
  onDownload: (file: FileInfo) => void;
}

const DocumentRenderer: React.FC<DocumentRendererProps> = ({
  file,
  namespace,
  location,
  currentPath,
  onClose,
  onDownload,
}) => {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const fileType = getFileType(file.name);
  const filePath = currentPath ? `${currentPath}${file.name}` : file.name;

  useEffect(() => {
    if (fileType === 'image' || fileType === 'unsupported') {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    storageService
      .viewFile(namespace, location, filePath, controller.signal)
      .then((raw) => {
        const text = normalizeToString(raw);
        setContent(fileType === 'json' ? formatJsonContent(text) : text);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'Failed to load file.');
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [namespace, location.id, location.type, filePath, fileType]);

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current); };
  }, []);

  const handleCopy = (_event: React.MouseEvent, text: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
      },
      () => { /* clipboard access denied — ignore silently */ },
    );
  };

  const imageUrl = fileType === 'image'
    ? (() => {
        const encodedPath = base64Encode(filePath);
        const route = location.type === 's3'
          ? `/objects/download/${encodeURIComponent(location.id)}/${encodedPath}`
          : `/local/download/${encodeURIComponent(location.id)}/${encodedPath}`;
        return apiClient.getDownloadUrl(namespace, route);
      })()
    : null;

  const renderContent = () => {
    if (loading) {
      return (
        <Bullseye>
          <Spinner aria-label="Loading file content" />
        </Bullseye>
      );
    }

    if (error) {
      return (
        <Alert variant="danger" title="Failed to load file" isInline>
          {error}
        </Alert>
      );
    }

    if (fileType === 'image') {
      return (
        <Bullseye>
          <img
            src={typeof imageUrl === 'string' ? imageUrl : ''}
            alt={file.name}
            style={{ maxWidth: '100%', maxHeight: '70vh' }}
            data-testid="preview-image"
          />
        </Bullseye>
      );
    }

    if (fileType === 'unsupported') {
      return (
        <Bullseye>
          <Content component="p">
            This file type cannot be previewed.{' '}
            <Button variant="link" isInline onClick={() => onDownload(file)}>
              Download to view
            </Button>
            .
          </Content>
        </Bullseye>
      );
    }

    const actions = content ? (
      <CodeBlockAction>
        <ClipboardCopyButton
          id="copy-preview"
          aria-label="Copy to clipboard"
          onClick={(event) => handleCopy(event, content)}
          variant="plain"
        >
          {copied ? 'Copied!' : 'Copy'}
        </ClipboardCopyButton>
      </CodeBlockAction>
    ) : undefined;

    return (
      <CodeBlock actions={actions}>
        <CodeBlockCode id="preview-code">{content}</CodeBlockCode>
      </CodeBlock>
    );
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      aria-label={`Preview ${file.name}`}
      variant="large"
    >
      <ModalHeader title={file.name} />
      <ModalBody>{renderContent()}</ModalBody>
      <ModalFooter>
        <Button
          variant="secondary"
          icon={<DownloadIcon />}
          onClick={() => onDownload(file)}
        >
          Download
        </Button>
        <Button variant="link" onClick={onClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export { isPreviewable };
export default DocumentRenderer;
