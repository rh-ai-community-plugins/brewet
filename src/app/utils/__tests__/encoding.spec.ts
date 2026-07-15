import { base64Encode, base64Decode } from '../encoding';

describe('encoding', () => {
  describe('base64Encode', () => {
    it('should encode a simple ASCII string', () => {
      expect(base64Encode('hello')).toBe(btoa('hello'));
    });

    it('should encode a path with slashes', () => {
      const path = 'folder/subfolder/file.txt';
      const encoded = base64Encode(path);
      expect(base64Decode(encoded)).toBe(path);
    });

    it('should handle Unicode characters', () => {
      const str = 'café résumé';
      const encoded = base64Encode(str);
      expect(base64Decode(encoded)).toBe(str);
    });

    it('should handle empty string', () => {
      expect(base64Encode('')).toBe('');
    });
  });

  describe('base64Decode', () => {
    it('should decode a base64 string', () => {
      const encoded = btoa('test');
      expect(base64Decode(encoded)).toBe('test');
    });

    it('should roundtrip with base64Encode', () => {
      const original = 'path/to/some file.json';
      expect(base64Decode(base64Encode(original))).toBe(original);
    });
  });
});
