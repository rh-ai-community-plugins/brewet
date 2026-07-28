import path from 'path';

export const DEFAULT_ALLOWED_EXTENSIONS = [
  '.safetensors', '.bin', '.pt', '.pth', '.onnx', '.gguf', '.h5',
  '.csv', '.json', '.jsonl', '.parquet', '.arrow', '.feather',
  '.txt', '.md', '.yaml', '.yml',
  '.tar', '.gz', '.zip', '.tgz',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp',
  '.wav', '.mp3', '.mp4', '.avi',
  '.ipynb', '.py',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.odt', '.ods', '.odp', '.rtf',
  '.xml', '.html', '.css',
  '.old', '.bak', '.backup', '.tmp',
  '.log', '.sql',
];

export const DEFAULT_BLOCKED_EXTENSIONS = [
  '.exe', '.dll', '.so', '.dylib', '.sh', '.bat', '.cmd', '.com',
  '.js', '.ts', '.rb', '.pl', '.php',
  '.sys', '.drv',
];

function parseExtensions(envValue: string | undefined): string[] {
  if (!envValue || envValue.trim() === '') return [];
  return envValue
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') || ext === '*' ? ext : `.${ext}`));
}

function buildAllowedExtensions(): string[] {
  const override = process.env.ALLOWED_FILE_EXTENSIONS;
  if (override !== undefined && override.trim() !== '') return parseExtensions(override);
  return [...DEFAULT_ALLOWED_EXTENSIONS];
}

function buildBlockedExtensions(): string[] {
  const override = process.env.BLOCKED_FILE_EXTENSIONS;
  if (override !== undefined && override.trim() !== '') return parseExtensions(override);
  return [...DEFAULT_BLOCKED_EXTENSIONS];
}

let allowedExtensions = buildAllowedExtensions();
let blockedExtensions = buildBlockedExtensions();

function globToRegex(pattern: string): RegExp {
  const normalized = pattern.startsWith('.') || pattern === '*' ? pattern : `.${pattern}`;
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function extensionMatchesAny(ext: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.includes('*')) return globToRegex(pattern).test(ext);
    return ext === pattern;
  });
}

export interface FileValidationResult {
  allowed: boolean;
  reason?: string;
}

export function validateFileType(filename: string): FileValidationResult {
  const ext = path.extname(filename).toLowerCase();

  if (!ext) {
    return { allowed: false, reason: 'Files without extensions are not allowed' };
  }

  if (extensionMatchesAny(ext, blockedExtensions)) {
    return { allowed: false, reason: `File type ${ext} is blocked for security reasons` };
  }

  if (!extensionMatchesAny(ext, allowedExtensions)) {
    return { allowed: false, reason: `File type ${ext} is not in the allowed list` };
  }

  return { allowed: true };
}

export function getAllowedExtensions(): string[] {
  return [...allowedExtensions];
}

export function getBlockedExtensions(): string[] {
  return [...blockedExtensions];
}

export function updateAllowedExtensions(extensions: string[]): void {
  const normalized = extensions
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') || ext === '*' ? ext : `.${ext}`));
  allowedExtensions = normalized.length > 0 ? normalized : [...DEFAULT_ALLOWED_EXTENSIONS];
}

export function updateBlockedExtensions(extensions: string[]): void {
  const normalized = extensions
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => ext.length > 0)
    .map((ext) => (ext.startsWith('.') || ext === '*' ? ext : `.${ext}`));
  blockedExtensions = normalized.length > 0 ? normalized : [...DEFAULT_BLOCKED_EXTENSIONS];
}
