import { base64Decode } from '../../src/utils/encoding';

describe('base64Decode', () => {
  it('decodes standard ASCII strings (standard base64)', () => {
    const encoded = Buffer.from('hello world').toString('base64');
    expect(base64Decode(encoded)).toBe('hello world');
  });

  it('decodes URL-safe base64 (no padding, `-` and `_` variants)', () => {
    // URL-safe base64 of 'hello world' — replace '+' with '-', '/' with '_', strip '='
    const standard = Buffer.from('hello world').toString('base64');
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(base64Decode(urlSafe)).toBe('hello world');
  });

  it('decodes Unicode strings (standard base64)', () => {
    const encoded = Buffer.from("Capture d'écran.png").toString('base64');
    expect(base64Decode(encoded)).toBe("Capture d'écran.png");
  });

  it('decodes Unicode strings (URL-safe base64)', () => {
    const standard = Buffer.from("Capture d'écran.png").toString('base64');
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(base64Decode(urlSafe)).toBe("Capture d'écran.png");
  });

  it('decodes file paths with special characters', () => {
    const encoded = Buffer.from('folder/subfolder/file name.txt').toString('base64');
    expect(base64Decode(encoded)).toBe('folder/subfolder/file name.txt');
  });

  it('decodes a path whose standard base64 contains slashes (URL-safe)', () => {
    // 'query?id=1' → standard base64 'cXVlcnk/aWQ9MQ==' → contains '/'
    const original = 'query?id=1';
    const standard = Buffer.from(original).toString('base64');
    const urlSafe = standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(urlSafe).not.toContain('/');
    expect(base64Decode(urlSafe)).toBe(original);
  });

  it('handles empty base64 string', () => {
    expect(base64Decode('')).toBe('');
  });
});
