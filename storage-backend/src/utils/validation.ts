export function validateBucketName(bucketName: string | undefined): string | null {
  if (!bucketName || typeof bucketName !== 'string' || bucketName === '') {
    return 'Bucket name is required.';
  }

  if (bucketName.length < 3 || bucketName.length > 63) {
    return 'Bucket name must be between 3 and 63 characters.';
  }

  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucketName)) {
    return 'Bucket name format is invalid.';
  }

  const invalidPatterns = [
    /^xn--/,                    // Punycode prefix
    /--/,                       // Consecutive hyphens
    /\.\./ ,                    // Consecutive periods
    /\.-|-\./,                  // Period adjacent to hyphen
    /^(\d{1,3}\.){3}\d{1,3}$/, // IP address format
  ];
  if (invalidPatterns.some((pattern) => pattern.test(bucketName))) {
    return 'Bucket name contains invalid patterns.';
  }

  return null;
}

export function validateQuery(q: string | undefined): string | null {
  if (q === undefined) return null;
  if (typeof q !== 'string') return 'Query must be a string.';
  if (q.length === 0 || q.length > 256) return 'Query length must be between 1 and 256 characters.';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(q)) return 'Query contains invalid control characters.';
  return null;
}

export function validateContinuationToken(token: string | undefined): string | null {
  if (token === undefined) return null;
  if (typeof token !== 'string') return 'Continuation token must be a string.';
  if (token.length === 0 || token.length > 512) return 'Continuation token length is invalid.';
  if (!/^[A-Za-z0-9+/=\-_.]+$/.test(token)) return 'Continuation token format is invalid.';
  return null;
}

export function validateAndDecodePrefix(prefix: string | undefined): {
  decoded: string;
  error: string | null;
} {
  if (!prefix) return { decoded: '', error: null };
  if (typeof prefix !== 'string' || prefix.length > 2048) {
    return { decoded: '', error: 'Prefix parameter is invalid.' };
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(prefix)) {
    return { decoded: '', error: 'Prefix is not valid base64.' };
  }

  let decoded: string;
  try {
    decoded = Buffer.from(prefix, 'base64').toString('utf-8');
  } catch {
    return { decoded: '', error: 'Prefix is not valid base64.' };
  }

  if (decoded.length > 1024) return { decoded: '', error: 'Decoded prefix is too long.' };
  if (decoded.includes('..') || decoded.includes('\0')) {
    return { decoded: '', error: 'Prefix contains invalid characters.' };
  }

  return { decoded, error: null };
}
