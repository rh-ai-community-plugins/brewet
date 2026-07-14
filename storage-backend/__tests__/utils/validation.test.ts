import {
  validateBucketName,
  validateQuery,
  validateContinuationToken,
  validateAndDecodePrefix,
} from '../../src/utils/validation';

describe('validateBucketName', () => {
  it('rejects empty/missing name', () => {
    expect(validateBucketName(undefined)).toBeTruthy();
    expect(validateBucketName('')).toBeTruthy();
  });

  it('rejects names shorter than 3 chars', () => {
    expect(validateBucketName('ab')).toBeTruthy();
  });

  it('rejects names longer than 63 chars', () => {
    expect(validateBucketName('a'.repeat(64))).toBeTruthy();
  });

  it('rejects names with uppercase letters', () => {
    expect(validateBucketName('MyBucket')).toBeTruthy();
  });

  it('rejects names starting with hyphen', () => {
    expect(validateBucketName('-my-bucket')).toBeTruthy();
  });

  it('rejects names with consecutive hyphens', () => {
    expect(validateBucketName('my--bucket')).toBeTruthy();
  });

  it('rejects xn-- prefix', () => {
    expect(validateBucketName('xn--bucket')).toBeTruthy();
  });

  it('rejects IP-like format', () => {
    expect(validateBucketName('192.168.1.1')).toBeTruthy();
  });

  it('accepts valid bucket names', () => {
    expect(validateBucketName('my-bucket')).toBeNull();
    expect(validateBucketName('bucket-123')).toBeNull();
    expect(validateBucketName('abc')).toBeNull();
  });
});

describe('validateQuery', () => {
  it('allows undefined (optional)', () => {
    expect(validateQuery(undefined)).toBeNull();
  });

  it('rejects empty strings', () => {
    expect(validateQuery('')).toBeTruthy();
  });

  it('rejects strings over 256 chars', () => {
    expect(validateQuery('a'.repeat(257))).toBeTruthy();
  });

  it('rejects special characters', () => {
    expect(validateQuery('test<script>')).toBeTruthy();
    expect(validateQuery("'; DROP TABLE")).toBeTruthy();
  });

  it('accepts valid queries', () => {
    expect(validateQuery('model-v2')).toBeNull();
    expect(validateQuery('test file.txt')).toBeNull();
  });
});

describe('validateContinuationToken', () => {
  it('allows undefined (optional)', () => {
    expect(validateContinuationToken(undefined)).toBeNull();
  });

  it('rejects empty strings', () => {
    expect(validateContinuationToken('')).toBeTruthy();
  });

  it('rejects tokens over 512 chars', () => {
    expect(validateContinuationToken('a'.repeat(513))).toBeTruthy();
  });

  it('accepts valid base64-like tokens', () => {
    expect(validateContinuationToken('abc123+/=')).toBeNull();
  });
});

describe('validateAndDecodePrefix', () => {
  it('returns empty for undefined', () => {
    const result = validateAndDecodePrefix(undefined);
    expect(result.decoded).toBe('');
    expect(result.error).toBeNull();
  });

  it('decodes valid base64', () => {
    const encoded = Buffer.from('folder/subfolder/').toString('base64');
    const result = validateAndDecodePrefix(encoded);
    expect(result.decoded).toBe('folder/subfolder/');
    expect(result.error).toBeNull();
  });

  it('rejects path traversal in decoded prefix', () => {
    const encoded = Buffer.from('../../../etc/passwd').toString('base64');
    const result = validateAndDecodePrefix(encoded);
    expect(result.error).toBeTruthy();
  });

  it('rejects null bytes in decoded prefix', () => {
    const encoded = Buffer.from('test\0path').toString('base64');
    const result = validateAndDecodePrefix(encoded);
    expect(result.error).toBeTruthy();
  });
});
