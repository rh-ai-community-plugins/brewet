import {
  validateFileType,
  getAllowedExtensions,
  getBlockedExtensions,
  updateAllowedExtensions,
  updateBlockedExtensions,
  DEFAULT_ALLOWED_EXTENSIONS,
  DEFAULT_BLOCKED_EXTENSIONS,
} from '../../src/utils/fileValidation';

describe('fileValidation', () => {
  afterEach(() => {
    updateAllowedExtensions(DEFAULT_ALLOWED_EXTENSIONS);
    updateBlockedExtensions(DEFAULT_BLOCKED_EXTENSIONS);
  });

  describe('validateFileType', () => {
    it('allows ML model files', () => {
      expect(validateFileType('model.safetensors')).toEqual({ allowed: true });
      expect(validateFileType('weights.bin')).toEqual({ allowed: true });
      expect(validateFileType('model.onnx')).toEqual({ allowed: true });
      expect(validateFileType('model.gguf')).toEqual({ allowed: true });
    });

    it('allows data files', () => {
      expect(validateFileType('data.csv')).toEqual({ allowed: true });
      expect(validateFileType('config.json')).toEqual({ allowed: true });
      expect(validateFileType('train.parquet')).toEqual({ allowed: true });
    });

    it('allows text files', () => {
      expect(validateFileType('readme.md')).toEqual({ allowed: true });
      expect(validateFileType('notes.txt')).toEqual({ allowed: true });
      expect(validateFileType('config.yaml')).toEqual({ allowed: true });
    });

    it('allows Python files', () => {
      expect(validateFileType('script.py')).toEqual({ allowed: true });
      expect(validateFileType('train.py')).toEqual({ allowed: true });
    });

    it('blocks executables', () => {
      const result = validateFileType('malware.exe');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('blocks scripts (except Python)', () => {
      expect(validateFileType('script.js').allowed).toBe(false);
      expect(validateFileType('run.sh').allowed).toBe(false);
    });

    it('blocks system files', () => {
      expect(validateFileType('driver.sys').allowed).toBe(false);
      expect(validateFileType('lib.dll').allowed).toBe(false);
    });

    it('rejects files without extensions', () => {
      const result = validateFileType('Makefile');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('without extensions');
    });

    it('rejects unknown extensions', () => {
      const result = validateFileType('file.xyz123');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in the allowed list');
    });
  });

  describe('glob matching', () => {
    it('matches wildcard patterns in blocked list', () => {
      updateBlockedExtensions(['.exe', '.p*']);
      expect(validateFileType('script.py').allowed).toBe(false);
      expect(validateFileType('code.pl').allowed).toBe(false);
      expect(validateFileType('page.php').allowed).toBe(false);
    });

    it('matches wildcard patterns in allowed list', () => {
      updateAllowedExtensions(['.t*']);
      updateBlockedExtensions(['.zzz']);
      expect(validateFileType('file.txt').allowed).toBe(true);
      expect(validateFileType('file.tar').allowed).toBe(true);
      expect(validateFileType('file.tgz').allowed).toBe(true);
    });

    it('matches * wildcard (any extension)', () => {
      updateAllowedExtensions(['*']);
      updateBlockedExtensions([]);
      expect(validateFileType('file.anything').allowed).toBe(true);
      expect(validateFileType('file.xyz').allowed).toBe(true);
    });

    it('blocked patterns take priority over allowed', () => {
      updateAllowedExtensions(['*']);
      updateBlockedExtensions(['.exe']);
      expect(validateFileType('file.txt').allowed).toBe(true);
      expect(validateFileType('file.exe').allowed).toBe(false);
    });
  });

  describe('runtime updates', () => {
    it('updateAllowedExtensions changes the allowed list', () => {
      updateAllowedExtensions(['.custom1', '.custom2']);
      expect(getAllowedExtensions()).toEqual(['.custom1', '.custom2']);
      expect(validateFileType('file.custom1').allowed).toBe(true);
      expect(validateFileType('data.csv').allowed).toBe(false);
    });

    it('updateBlockedExtensions changes the blocked list', () => {
      updateBlockedExtensions(['.csv']);
      expect(getBlockedExtensions()).toEqual(['.csv']);
      expect(validateFileType('data.csv').allowed).toBe(false);
    });

    it('normalizes extensions on update', () => {
      updateAllowedExtensions(['PY', ' .TXT ', 'json']);
      expect(getAllowedExtensions()).toEqual(['.py', '.txt', '.json']);
    });

    it('filters empty entries on update', () => {
      updateAllowedExtensions(['.py', '', '  ', '.txt']);
      expect(getAllowedExtensions()).toEqual(['.py', '.txt']);
    });

    it('resets to defaults when allowed list is empty', () => {
      updateAllowedExtensions([]);
      expect(getAllowedExtensions()).toEqual(DEFAULT_ALLOWED_EXTENSIONS);
      expect(validateFileType('script.py').allowed).toBe(true);
    });

    it('resets to defaults when blocked list is empty', () => {
      updateBlockedExtensions([]);
      expect(getBlockedExtensions()).toEqual(DEFAULT_BLOCKED_EXTENSIONS);
      expect(validateFileType('malware.exe').allowed).toBe(false);
    });

    it('resets to defaults when all entries are whitespace', () => {
      updateAllowedExtensions(['', '  ', ' ']);
      expect(getAllowedExtensions()).toEqual(DEFAULT_ALLOWED_EXTENSIONS);
    });
  });

  describe('getAllowedExtensions', () => {
    it('returns an array of extensions', () => {
      const extensions = getAllowedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
      expect(extensions.every((ext) => ext.startsWith('.'))).toBe(true);
    });

    it('includes .py in defaults', () => {
      expect(getAllowedExtensions()).toContain('.py');
    });
  });

  describe('getBlockedExtensions', () => {
    it('returns an array of extensions', () => {
      const extensions = getBlockedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
      expect(extensions).toContain('.exe');
    });

    it('does not include .py in defaults', () => {
      expect(getBlockedExtensions()).not.toContain('.py');
    });
  });
});
