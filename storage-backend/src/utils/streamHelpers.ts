import { Transform, TransformCallback } from 'stream';
import { Upload } from '@aws-sdk/lib-storage';

const DEFAULT_PROGRESS_THRESHOLD = 1024 * 1024; // 1 MB

export function createProgressTransform(
  onProgress: (loaded: number) => void,
  thresholdBytes = DEFAULT_PROGRESS_THRESHOLD,
): Transform {
  let loaded = 0;
  let lastReported = 0;

  return new Transform({
    transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
      loaded += chunk.length;
      if (loaded - lastReported >= thresholdBytes) {
        lastReported = loaded;
        onProgress(loaded);
      }
      callback(null, chunk);
    },
    flush(callback: TransformCallback) {
      if (loaded !== lastReported) {
        onProgress(loaded);
      }
      callback();
    },
  });
}

export async function uploadWithCleanup(
  upload: Upload,
  onProgress?: (loaded: number) => void,
): Promise<void> {
  const handler = onProgress
    ? (progress: { loaded?: number }) => {
        if (progress.loaded !== undefined) onProgress(progress.loaded);
      }
    : undefined;

  if (handler) {
    upload.on('httpUploadProgress', handler);
  }

  try {
    await upload.done();
  } finally {
    upload.removeAllListeners();
  }
}
