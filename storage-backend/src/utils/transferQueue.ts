import { EventEmitter } from 'events';
import pLimit from 'p-limit';
import { getMaxConcurrentTransfers } from './config';

export type TransferStatus = 'queued' | 'active' | 'completed' | 'failed' | 'cancelled';
export type TransferFileStatus = 'pending' | 'active' | 'completed' | 'failed' | 'cancelled';
export type TransferType = 's3-upload' | 's3-download' | 'local-upload' | 'cross-storage' | 'huggingface';

export interface TransferFileJob {
  sourcePath: string;
  destinationPath: string;
  size: number;
  status: TransferFileStatus;
  loaded: number;
  error?: string;
}

export interface TransferProgress {
  jobId: string;
  status: TransferStatus;
  type: TransferType;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  cancelledFiles: number;
  totalBytes: number;
  loadedBytes: number;
  currentFile?: string;
  error?: string;
  files: TransferFileJob[];
}

export interface TransferJob {
  id: string;
  type: TransferType;
  status: TransferStatus;
  files: TransferFileJob[];
  abortController: AbortController;
  createdAt: number;
  completedAt?: number;
}

export type TransferExecutor = (
  file: TransferFileJob,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
) => Promise<void>;

let jobCounter = 0;

const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

export class TransferQueue extends EventEmitter {
  private jobs = new Map<string, TransferJob>();
  private limiter: ReturnType<typeof pLimit>;
  private metadataLimiter: ReturnType<typeof pLimit>;
  private lastEmitTime = new Map<string, number>();

  constructor(concurrency: number) {
    super();
    this.limiter = pLimit(concurrency);
    this.metadataLimiter = pLimit(20);
  }

  private evictExpiredJobs(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.completedAt && now - job.completedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
        this.lastEmitTime.delete(id);
      }
    }
  }

  getLimiter(): ReturnType<typeof pLimit> {
    return this.limiter;
  }

  getMetadataLimiter(): ReturnType<typeof pLimit> {
    return this.metadataLimiter;
  }

  updateConcurrency(concurrency: number): void {
    this.limiter = pLimit(concurrency);
  }

  queueJob(type: TransferType, files: TransferFileJob[], executor: TransferExecutor): string {
    this.evictExpiredJobs();
    const jobId = `transfer-${++jobCounter}-${Date.now()}`;
    const abortController = new AbortController();

    const job: TransferJob = {
      id: jobId,
      type,
      status: 'queued',
      files,
      abortController,
      createdAt: Date.now(),
    };

    this.jobs.set(jobId, job);
    this.processFiles(job, executor);
    return jobId;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'failed') {
      return false;
    }

    job.abortController.abort();
    job.status = 'cancelled';
    job.completedAt = Date.now();

    for (const file of job.files) {
      if (file.status === 'pending' || file.status === 'active') {
        file.status = 'cancelled';
        file.error = 'Cancelled by user';
      }
    }

    this.emitProgress(jobId, true);
    this.lastEmitTime.delete(jobId);
    return true;
  }

  getJob(jobId: string): TransferJob | undefined {
    return this.jobs.get(jobId);
  }

  getProgress(jobId: string): TransferProgress | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return this.buildProgress(job);
  }

  private async processFiles(job: TransferJob, executor: TransferExecutor): Promise<void> {
    job.status = 'active';
    this.emitProgress(job.id, true);

    const promises = job.files.map((file) =>
      this.limiter(async () => {
        if (job.abortController.signal.aborted) {
          if (file.status === 'pending') {
            file.status = 'cancelled';
            file.error = 'Cancelled by user';
          }
          return;
        }

        file.status = 'active';
        this.emitProgress(job.id);

        try {
          await executor(file, job.abortController.signal, (loaded: number) => {
            file.loaded = loaded;
            this.emitProgress(job.id);
          });

          if (job.abortController.signal.aborted) {
            file.status = 'cancelled';
            file.error = 'Cancelled by user';
          } else {
            file.status = 'completed';
            file.loaded = file.size;
          }
        } catch (err: unknown) {
          if (job.abortController.signal.aborted) {
            file.status = 'cancelled';
            file.error = 'Cancelled by user';
          } else {
            file.status = 'failed';
            file.error = err instanceof Error ? err.message : 'Unknown error';
          }
        }

        this.emitProgress(job.id);
      }),
    );

    await Promise.allSettled(promises);

    if (job.abortController.signal.aborted) return;

    const hasFailures = job.files.some((f) => f.status === 'failed');
    job.status = hasFailures ? 'failed' : 'completed';
    job.completedAt = Date.now();

    this.emitProgress(job.id, true);
    this.lastEmitTime.delete(job.id);
  }

  private emitProgress(jobId: string, force = false): void {
    if (!force) {
      const now = Date.now();
      const last = this.lastEmitTime.get(jobId) || 0;
      if (now - last < 1000) return;
      this.lastEmitTime.set(jobId, now);
    } else {
      this.lastEmitTime.set(jobId, Date.now());
    }

    const job = this.jobs.get(jobId);
    if (!job) return;

    this.emit('progress', this.buildProgress(job));
  }

  private buildProgress(job: TransferJob): TransferProgress {
    const activeFile = job.files.find((f) => f.status === 'active');
    return {
      jobId: job.id,
      status: job.status,
      type: job.type,
      totalFiles: job.files.length,
      completedFiles: job.files.filter((f) => f.status === 'completed').length,
      failedFiles: job.files.filter((f) => f.status === 'failed').length,
      cancelledFiles: job.files.filter((f) => f.status === 'cancelled').length,
      totalBytes: job.files.reduce((sum, f) => sum + f.size, 0),
      loadedBytes: job.files.reduce((sum, f) => sum + f.loaded, 0),
      currentFile: activeFile?.sourcePath,
      files: job.files,
    };
  }
}

export const transferQueue = new TransferQueue(getMaxConcurrentTransfers());

export function updateTransferQueueConcurrency(concurrency: number): void {
  transferQueue.updateConcurrency(concurrency);
}
