import { createProgressTransform, uploadWithCleanup } from '../../src/utils/streamHelpers';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { EventEmitter } from 'events';

describe('createProgressTransform', () => {
  it('throttles progress callbacks based on threshold', async () => {
    const progressCalls: number[] = [];
    const transform = createProgressTransform(
      (loaded) => progressCalls.push(loaded),
      100,
    );

    const input = new PassThrough();
    const output = new PassThrough();

    const pipelinePromise = pipeline(input, transform, output);

    input.write(Buffer.alloc(50));
    input.write(Buffer.alloc(50));
    input.write(Buffer.alloc(50));
    input.end();

    await pipelinePromise;

    expect(progressCalls[0]).toBe(100);
    expect(progressCalls[progressCalls.length - 1]).toBe(150);
  });

  it('always emits final progress on flush', async () => {
    const progressCalls: number[] = [];
    const transform = createProgressTransform(
      (loaded) => progressCalls.push(loaded),
      1024 * 1024,
    );

    const input = new PassThrough();
    const output = new PassThrough();

    const pipelinePromise = pipeline(input, transform, output);

    input.write(Buffer.alloc(100));
    input.end();

    await pipelinePromise;

    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0]).toBe(100);
  });

  it('does not emit if threshold not reached and data still flowing', async () => {
    const progressCalls: number[] = [];
    const transform = createProgressTransform(
      (loaded) => progressCalls.push(loaded),
      1000,
    );

    const input = new PassThrough();
    const output = new PassThrough();

    const pipelinePromise = pipeline(input, transform, output);

    input.write(Buffer.alloc(500));
    input.write(Buffer.alloc(600));
    input.end();

    await pipelinePromise;

    expect(progressCalls[0]).toBe(1100);
  });
});

describe('uploadWithCleanup', () => {
  it('calls done and removes listeners', async () => {
    const mockUpload = new EventEmitter() as any;
    mockUpload.done = jest.fn().mockResolvedValue(undefined);
    mockUpload.removeAllListeners = jest.fn();

    await uploadWithCleanup(mockUpload);

    expect(mockUpload.done).toHaveBeenCalledTimes(1);
    expect(mockUpload.removeAllListeners).toHaveBeenCalledTimes(1);
  });

  it('removes listeners even on failure', async () => {
    const mockUpload = new EventEmitter() as any;
    mockUpload.done = jest.fn().mockRejectedValue(new Error('upload failed'));
    mockUpload.removeAllListeners = jest.fn();

    await expect(uploadWithCleanup(mockUpload)).rejects.toThrow('upload failed');
    expect(mockUpload.removeAllListeners).toHaveBeenCalledTimes(1);
  });

  it('registers progress listener when onProgress provided', async () => {
    const mockUpload = new EventEmitter() as any;
    mockUpload.done = jest.fn().mockResolvedValue(undefined);
    mockUpload.removeAllListeners = jest.fn();

    const onProgress = jest.fn();
    const onSpy = jest.spyOn(mockUpload, 'on');

    await uploadWithCleanup(mockUpload, onProgress);

    expect(onSpy).toHaveBeenCalledWith('httpUploadProgress', expect.any(Function));
  });
});
