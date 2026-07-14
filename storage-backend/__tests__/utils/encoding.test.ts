import { base64Decode } from '../../src/utils/encoding';

describe('base64Decode', () => {
  it('decodes standard ASCII strings', () => {
    const encoded = Buffer.from('hello world').toString('base64');
    expect(base64Decode(encoded)).toBe('hello world');
  });

  it('decodes Unicode strings', () => {
    const encoded = Buffer.from("Capture d'écran.png").toString('base64');
    expect(base64Decode(encoded)).toBe("Capture d'écran.png");
  });

  it('decodes file paths with special characters', () => {
    const encoded = Buffer.from('folder/subfolder/file name.txt').toString('base64');
    expect(base64Decode(encoded)).toBe('folder/subfolder/file name.txt');
  });

  it('handles empty base64 string', () => {
    expect(base64Decode('')).toBe('');
  });
});
