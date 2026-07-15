import { buildTransferPath } from '../transferUtils';
import type { StorageLocation } from '~/app/types/storage';

const s3: StorageLocation = { id: 'my-bucket', name: 'my-bucket', type: 's3', status: 'available' };
const pvc: StorageLocation = { id: 'local-0', name: 'pvc-data', type: 'pvc', status: 'available' };

describe('buildTransferPath', () => {
  it('should build S3 root path with no sub-path', () => {
    expect(buildTransferPath(s3, '')).toBe('s3:my-bucket');
  });

  it('should build S3 path with a sub-path', () => {
    expect(buildTransferPath(s3, 'models/llama')).toBe('s3:my-bucket/models/llama');
  });

  it('should strip trailing slash from sub-path', () => {
    expect(buildTransferPath(s3, 'data/models/')).toBe('s3:my-bucket/data/models');
  });

  it('should build PVC root path', () => {
    expect(buildTransferPath(pvc, '')).toBe('local:local-0');
  });

  it('should build PVC path with a sub-path', () => {
    expect(buildTransferPath(pvc, 'datasets')).toBe('local:local-0/datasets');
  });
});
