import { transferEmitter } from '../emitter';

describe('transferEmitter', () => {
  it('should call handler when event is emitted', () => {
    const handler = jest.fn();
    transferEmitter.on('transfer:started', handler);
    transferEmitter.emit('transfer:started', { jobId: 'j1', destination: 's3:bucket' });
    expect(handler).toHaveBeenCalledWith({ jobId: 'j1', destination: 's3:bucket' });
    transferEmitter.off('transfer:started', handler);
  });

  it('should not call handler after off()', () => {
    const handler = jest.fn();
    transferEmitter.on('transfer:completed', handler);
    transferEmitter.off('transfer:completed', handler);
    transferEmitter.emit('transfer:completed', { jobId: 'j2', destination: 'local:local-0' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support multiple listeners on the same event', () => {
    const h1 = jest.fn();
    const h2 = jest.fn();
    transferEmitter.on('transfer:cancelled', h1);
    transferEmitter.on('transfer:cancelled', h2);
    transferEmitter.emit('transfer:cancelled', { jobId: 'j3' });
    expect(h1).toHaveBeenCalledWith({ jobId: 'j3' });
    expect(h2).toHaveBeenCalledWith({ jobId: 'j3' });
    transferEmitter.off('transfer:cancelled', h1);
    transferEmitter.off('transfer:cancelled', h2);
  });

  it('should not error when emitting with no listeners', () => {
    expect(() => {
      transferEmitter.emit('transfer:started', { jobId: 'j4', destination: 's3:x' });
    }).not.toThrow();
  });
});
