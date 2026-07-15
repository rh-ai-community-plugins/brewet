import { formatBytes } from '../format';

describe('formatBytes', () => {
  it('returns "—" for undefined', () => {
    expect(formatBytes(undefined)).toBe('—');
  });

  it('returns "—" for negative values', () => {
    expect(formatBytes(-1)).toBe('—');
  });

  it('returns "0 B" for zero', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('returns bytes for small values', () => {
    expect(formatBytes(500)).toBe('500 B');
  });

  it('returns KB for kilobyte range', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('returns MB for megabyte range', () => {
    expect(formatBytes(1048576)).toBe('1 MB');
    expect(formatBytes(5242880)).toBe('5 MB');
  });

  it('returns GB for gigabyte range', () => {
    expect(formatBytes(1073741824)).toBe('1 GB');
  });

  it('strips trailing .0', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1048576)).toBe('1 MB');
  });
});
