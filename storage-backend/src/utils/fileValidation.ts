import path from 'path';

const DEFAULT_ALLOWED_EXTENSIONS = [
  '.safetensors', '.bin', '.pt', '.pth', '.onnx', '.gguf', '.h5',
  '.csv', '.json', '.jsonl', '.parquet', '.arrow', '.feather',
  '.txt', '.md', '.yaml', '.yml',
  '.tar', '.gz', '.zip', '.tgz',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp',
  '.wav', '.mp3', '.mp4', '.avi',
  '.ipynb',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf',
  '.xml', '.html', '.css',
  '.old', '.bak', '.backup', '.tmp',
  '.log', '.sql',
];

const DEFAULT_BLOCKED_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.com',
  '.js', '.ts', '.py', '.rb', '.pl', '.php',
  '.sys', '.drv',
];

function parseExtensions(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim() === '') return [];
  return envValue
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
}

function buildAllowedExtensions(): string[] {
  const override = process.env.ALLOWED_FILE_EXTENSIONS;
  const append = process.env.ALLOWED_FILE_EXTENSIONS_APPEND;
  if (override !== undefined) return parseExtensions(override);
  const extensions = [...DEFAULT_ALLOWED_EXTENSIONS];
  if (append !== undefined) extensions.push(...parseExtensions(append));
  return extensions;
}

function buildBlockedExtensions(): string[] {
  const override = process.env.BLOCKED_FILE_EXTENSIONS;
  const append = process.env.BLOCKED_FILE_EXTENSIONS_APPEND;
  if (override !== undefined) return parseExtensions(override);
  const extensions = [...DEFAULT_BLOCKED_EXTENSIONS];
  if (append !== undefined) extensions.push(...parseExtensions(append));
  return extensions;
}

const ALLOWED_EXTENSIONS = buildAllowedExtensions();
const BLOCKED_EXTENSIONS = buildBlockedExtensions();

export interface FileValidationResult {
  allowed: boolean;
  reason?: string;
}

export function validateFileType(filename: string): FileValidationResult {
  const ext = path.extname(filename).toLowerCase();

  if (!ext) {
    return { allowed: false, reason: 'Files without extensions are not allowed' };
  }

  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { allowed: false, reason: `File type ${ext} is blocked for security reasons` };
  }

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { allowed: false, reason: `File type ${ext} is not in the allowed list` };
  }

  return { allowed: true };
}

export function getAllowedExtensions(): string[] {
  return [...ALLOWED_EXTENSIONS];
}

export function getBlockedExtensions(): string[] {
  return [...BLOCKED_EXTENSIONS];
}
