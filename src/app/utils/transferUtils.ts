import type { StorageLocation } from '~/app/types/storage';

export function buildTransferPath(location: StorageLocation, path: string): string {
  const typeStr = location.type === 's3' ? 's3' : 'local';
  const cleanPath = path.replace(/\/$/, '');
  return cleanPath ? `${typeStr}:${location.id}/${cleanPath}` : `${typeStr}:${location.id}`;
}
