import {
  TransferQueue,
  TransferFileJob,
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
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor());
      expect(jobId).toMatch(/^transfer-\d+-\d+$/);
    });

    it('completes all files', async () => {
      const files = makeFiles(3);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor());

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
  });

  describe('cancelJob', () => {
    it('cancels a running job', async () => {
      const files = makeFiles(5);
      const jobId = queue.queueJob('cross-storage', files, delayedExecutor(5000));

      await new Promise((resolve) => setTimeout(resolve, 50));

      const cancelled = queue.cancelJob(jobId);
      expect(cancelled).toBe(true);

      const progress = queue.getProgress(jobId);
      expect(progress?.status).toBe('cancelled');
    });

    it('returns false for nonexistent job', () => {
      expect(queue.cancelJob('nonexistent')).toBe(false);
    });

    it('returns false for already completed job', async () => {
      const files = makeFiles(1);
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor());

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
      const jobId = queue.queueJob('s3-upload', files, immediateExecutor());

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
      const jobId = queue.queueJob('cross-storage', files, failingExecutor('disk full'));

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
      });

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
      const jobId = queue.queueJob('cross-storage', files, immediateExecutor());
      const job = queue.getJob(jobId);
      expect(job).toBeDefined();
      expect(job?.id).toBe(jobId);
      expect(job?.type).toBe('cross-storage');
    });

    it('returns undefined for nonexistent job', () => {
      expect(queue.getJob('nonexistent')).toBeUndefined();
    });
  });
});
