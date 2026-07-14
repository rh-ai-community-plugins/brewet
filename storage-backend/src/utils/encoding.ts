export function base64Decode(base64Str: string): string {
  try {
    return Buffer.from(base64Str, 'base64').toString('utf-8');
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to decode base64 string: ${errorMsg}`);
  }
}
