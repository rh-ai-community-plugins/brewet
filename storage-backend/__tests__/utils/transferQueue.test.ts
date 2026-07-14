import { promises as fsPromises } from 'fs';
import {
  TransferQueue,
  TransferFileJob,
  TransferJobDestination,
  TransferProgress,
  TransferExecutor,
} from '../../src/utils/transferQueue';

jest.mock('../../src/utils/config', () => ({
  getMaxConcurrentTransfers: () => 2,
}));

function makeFiles(count: number, size = 100): TransferFileJob[] {
  return Array.from({ length: count }, (_, i) => ({
    sourcePath: `source/file-${i}.txt`,
    destinationPath: `dest/file-${i}.txt`,
    size,
    status: 'pending' as const,
    loaded: 0,
  }));
}

function makeDestination(overrides?: Partial<TransferJobDestination>): TransferJobDestination {
  return { type: 's3', locationId: 'test-bucket', basePath: '', ...overrides };
}

function immediateExecutor(): TransferExecutor {
  return async (file, _signal, onProgress) => {
    onProgress(file.size);
  };
}

function delayedExecutor(ms: number): TransferExecutor {
  return async (file, signal, onProgress) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        onProgress(file.size);
        resolve();
      }, ms);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Cancelled'));
      }, { once: true });
    });
  };
}

function failingExecutor(message = 'test error'): TransferExecutor {
  return async () => {
    throw new Error(message);
  };
}

describe('TransferQueue', () => {
  let queue: TransferQueue;

  beforeEach(() => {
    queue = new TransferQueue(2);
  });

  describe('queueJob', () => {
    it('returns a job ID', () => {
      const files = makeFiles(1);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor(), makeDestination());
      expect(jobId).toMatch(/^transfer-\d+-\d+$/);
    });

    it('completes all files', async () => {
      const files = makeFiles(3);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor(), makeDestination());

      await new Promise<void>((resolve) => {
        queue.on('progress', (progress: TransferProgress) => {
          if (progress.jobId === jobId && progress.status === 'completed') {
            resolve();
          }
        });
      });

      const progress = queue.getProgress(jobId);
      expect(progress?.status).toBe('completed');
      expect(progress?.completedFiles).toBe(3);
      expect(progress?.failedFiles).toBe(0);
    });

    it('stores destination info on the job', () => {
      const files = makeFiles(1);
      const destination = makeDestination({ type: 'local', locationId: 'local-0', basePath: 'uploads' });
      const jobId = queue.queueJob('local-upload', files, immediateExecutor(), destination);
      const job = queue.getJob(jobId);
      expect(job?.destination).toEqual(destination);
    });
  });

  describe('cancelJob', () => {
    it('cancels a running job', async () => {
      const files = makeFiles(5);
      const jobId = queue.queueJob('cross-storage', files, delayedExecutor(5000), makeDestination());

      await new Promise((resolve) => setTimeout(resolve, 50));

      const cancelled = queue.cancelJob(jobId);
      expect(cancelled).toBe(true);

      const progress = queue.getProgress(jobId);
      expect(progress?.status).toBe('cancelled');
    });

    it('returns false for nonexistent job', () => {
      expect(queue.cancelJob('nonexistent')).toBe(false);
    });

    it('cleans up partial files when executor handles abort', async () => {
      const tmpDir = '/tmp/test-storage';
      await fsPromises.mkdir(tmpDir, { recursive: true });
      const tmpFile = `${tmpDir}/abort-test-${Date.now()}.tmp`;

      const writingExecutor: TransferExecutor = async (_file, signal, onProgress) => {
        await fsPromises.writeFile(tmpFile, 'partial content');
        onProgress(10);

        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('Cancelled'));
          }, { once: true });
        });
      };

      const files = makeFiles(1);
      const jobId = queue.queueJob('s3-download', files, async (file, signal, onProgress) => {
        try {
          await writingExecutor(file, signal, onProgress);
        } catch {
          await fsPromises.unlink(tmpFile).catch(() => {});
          throw new Error('Cancelled');
        }
      }, makeDestination());

      await new Promise((resolve) => setTimeout(resolve, 50));
      queue.cancelJob(jobId);
      await new Promise((resolve) => setTimeout(resolve, 50));

      await expect(fsPromises.access(tmpFile)).rejects.toThrow();
    });

    it('returns false for already completed job', async () => {
      const files = makeFiles(1);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor(), makeDestination());

      await new Promise<void>((resolve) => {
        queue.on('progress', (progress: TransferProgress) => {
          if (progress.jobId === jobId && progress.status === 'completed') resolve();
        });
      });

      expect(queue.cancelJob(jobId)).toBe(false);
    });
  });

  describe('getProgress', () => {
    it('returns undefined for nonexistent job', () => {
      expect(queue.getProgress('nonexistent')).toBeUndefined();
    });

    it('tracks bytes loaded', async () => {
      const files = makeFiles(2, 500);
      const jobId = queue.queueJob('s3-upload', files, immediateExecutor(), makeDestination());

      await new Promise<void>((resolve) => {
        queue.on('progress', (progress: TransferProgress) => {
          if (progress.jobId === jobId && progress.status === 'completed') resolve();
        });
      });

      const progress = queue.getProgress(jobId);
      expect(progress?.totalBytes).toBe(1000);
      expect(progress?.loadedBytes).toBe(1000);
    });
  });

  describe('failed transfers', () => {
    it('marks job as failed when files fail', async () => {
      const files = makeFiles(2);
      const jobId = queue.queueJob('cross-storage', files, failingExecutor('disk full'), makeDestination());

      await new Promise<void>((resolve) => {
        queue.on('progress', (progress: TransferProgress) => {
          if (progress.jobId === jobId && (progress.status === 'failed' || progress.status === 'completed')) {
            resolve();
          }
        });
      });

      const progress = queue.getProgress(jobId);
      expect(progress?.status).toBe('failed');
      expect(progress?.failedFiles).toBe(2);
    });
  });

  describe('throttled progress emission', () => {
    it('throttles progress events to 1/second', async () => {
      const progressEvents: TransferProgress[] = [];

      const files = makeFiles(1, 1000);
      const jobId = queue.queueJob('cross-storage', files, async (file, _signal, onProgress) => {
        for (let i = 0; i < 10; i++) {
          onProgress(i * 100);
        }
      }, makeDestination());

      queue.on('progress', (p: TransferProgress) => {
        if (p.jobId === jobId) progressEvents.push(p);
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Status change events (active, completed) always emit; intermediate progress is throttled
      const intermediateEvents = progressEvents.filter(
        (e) => e.status === 'active' && e.completedFiles === 0,
      );
      expect(intermediateEvents.length).toBeLessThanOrEqual(3);
    });
  });

  describe('updateConcurrency', () => {
    it('changes the concurrency limiter', () => {
      queue.updateConcurrency(10);
      expect(queue.getLimiter()).toBeDefined();
    });
  });

  describe('getJob', () => {
    it('returns the job object', () => {
      const files = makeFiles(1);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor(), makeDestination());
      const job = queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
      expect(job?.type).toBe('cross-storage');
    });

    it('works without destination info', () => {
      const files = makeFiles(1);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor());
      const job = queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.destination).toBeUndefined();
    });

    it('returns undefined for nonexistent job', () => {
      expect(queue.getJob('nonexistent')).toBeUndefined();
    });
  });
});
