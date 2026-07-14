export function sanitizeFilename(name: string): string {
  return name.replace(/["\r\n\\]/g, '_');
}
