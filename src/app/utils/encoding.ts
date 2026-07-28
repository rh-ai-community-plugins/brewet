/**
 * Encodes a string to URL-safe base64 (RFC 4648 §5).
 * Uses `-` instead of `+`, `_` instead of `/`, and strips `=` padding
 * so the result can be safely embedded in a URL path segment without
 * any `/` characters breaking Fastify named route params (`:encodedKey`).
 */
export function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a URL-safe base64 string (RFC 4648 §5).
 * Accepts both standard and URL-safe base64 with or without padding.
 */
export function base64Decode(base64Str: string): string {
  // Restore standard base64 alphabet and padding before calling atob
  const standard = base64Str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '=='.slice(0, (4 - (standard.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
