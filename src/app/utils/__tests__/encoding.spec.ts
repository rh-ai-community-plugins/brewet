import { base64Encode, base64Decode } from '../encoding';

describe('encoding', () => {
  describe('base64Encode', () => {
    it('should encode a simple ASCII string to URL-safe base64', () => {
      // 'hello' encodes to 'aGVsbG8=' in standard base64; URL-safe strips padding
      expect(base64Encode('hello')).toBe('aGVsbG8');
    });

    it('should produce no `/` characters in output', () => {
      // Standard base64 of 'query?id=1' contains a slash; URL-safe must not
      const encoded = base64Encode('query?id=1');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('=');
    });

    it('should encode a path with slashes and be decodable', () => {
      const path = 'folder/subfolder/file.txt';
      const encoded = base64Encode(path);
      expect(encoded).not.toContain('/');
      expect(base64Decode(encoded)).toBe(path);
    });

    it('should handle Unicode characters', () => {
      const str = 'café résumé';
      const encoded = base64Encode(str);
      expect(encoded).not.toContain('/');
      expect(base64Decode(encoded)).toBe(str);
    });

    it('should handle empty string', () => {
      expect(base64Encode('')).toBe('');
    });
  });

  describe('base64Decode', () => {
    it('should decode a URL-safe base64 string', () => {
      // URL-safe base64 of 'test' is 'dGVzdA' (no padding)
      expect(base64Decode('dGVzdA')).toBe('test');
    });

    it('should decode standard base64 with padding', () => {
      // Backward-compatible: still accept standard base64
      expect(base64Decode('dGVzdA==')).toBe('test');
    });

    it('should roundtrip with base64Encode', () => {
      const original = 'path/to/some file.json';
      expect(base64Decode(base64Encode(original))).toBe(original);
    });

    it('should roundtrip a string whose standard base64 contains slashes', () => {
      // 'query?id=1' → standard base64 has a '/' → URL-safe must still round-trip
      const original = 'query?id=1';
      expect(base64Decode(base64Encode(original))).toBe(original);
    });
  });
});
