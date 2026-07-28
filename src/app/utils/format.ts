const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes?: number): string {
  if (bytes == null || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const exponent = Math.min(Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const formatted = exponent === 0 ? value.toString() : value.toFixed(1).replace(/\.0$/, '');
  return `${formatted} ${UNITS[exponent]}`;
}
