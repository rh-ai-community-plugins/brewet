/**
 * Decodes a URL-safe base64 string (RFC 4648 §5).
 * Accepts both standard base64 (with `+`/`/`) and URL-safe base64
 * (with `-`/`_`), with or without `=` padding.
 */
export function base64Decode(base64Str: string): string {
  try {
    if (base64Str === '') return '';
    // Restore standard base64 alphabet and padding before decoding
    const standard = base64Str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = standard + '=='.slice(0, (4 - (standard.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('utf-8');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to decode base64 string: ${errorMsg}`);
  }
}
