import { validateFileType, getAllowedExtensions, getBlockedExtensions } from '../../src/utils/fileValidation';

describe('fileValidation', () => {
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

    it('blocks executables', () => {
      const result = validateFileType('malware.exe');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('blocks scripts', () => {
      expect(validateFileType('script.js').allowed).toBe(false);
      expect(validateFileType('hack.py').allowed).toBe(false);
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

  describe('getAllowedExtensions', () => {
    it('returns an array of extensions', () => {
      const extensions = getAllowedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
      expect(extensions.every((ext) => ext.startsWith('.'))).toBe(true);
    });
  });

  describe('getBlockedExtensions', () => {
    it('returns an array of extensions', () => {
      const extensions = getBlockedExtensions();
      expect(Array.isArray(extensions)).toBe(true);
      expect(extensions.length).toBeGreaterThan(0);
      expect(extensions).toContain('.exe');
    });
  });
});
