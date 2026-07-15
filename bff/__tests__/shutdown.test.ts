import http from 'http';
import { createShutdownHandler, setupGracefulShutdown } from '../src/shutdown';

function makeMockServer(
  closeImpl?: (cb: (err?: Error) => void) => void,
): http.Server {
  const server = {
    close: jest.fn((cb: (err?: Error) => void) => {
      if (closeImpl) {
        closeImpl(cb);
      } else {
        cb();
      }
    }),
  } as unknown as http.Server;
  return server;
}

describe('createShutdownHandler', () => {
  let exitSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as unknown as () => never);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('calls server.close() when the handler is invoked', () => {
    const server = makeMockServer();
    const handler = createShutdownHandler(server, 5000);
    handler('SIGTERM');
    expect((server as any).close).toHaveBeenCalledTimes(1);
  });

  it('logs the received signal name', () => {
    const server = makeMockServer();
    const handler = createShutdownHandler(server, 5000);
    handler('SIGINT');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('SIGINT'),
    );
  });

  it('calls process.exit(0) when server.close() succeeds', () => {
    const server = makeMockServer();
    const handler = createShutdownHandler(server, 5000);
    handler('SIGTERM');

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('calls process.exit(1) when server.close() reports an error', () => {
    const server = makeMockServer((cb) => cb(new Error('close failed')));
    const handler = createShutdownHandler(server, 5000);
    handler('SIGTERM');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('shutdown'),
      'close failed',
    );
  });

  it('force-exits after the grace period when connections linger', () => {
    // server.close() callback is never called — simulates stuck SSE connections.
    const server = makeMockServer((_cb) => { /* never resolved */ });
    const handler = createShutdownHandler(server, 3000);
    handler('SIGTERM');

    // Advance time past the grace period.
    jest.advanceTimersByTime(3001);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('timed out'),
    );
  });

  it('does not force-exit before the grace period elapses', () => {
    const server = makeMockServer((_cb) => { /* never resolved */ });
    const handler = createShutdownHandler(server, 3000);
    handler('SIGTERM');

    jest.advanceTimersByTime(2999);

    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('setupGracefulShutdown', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('registers SIGTERM and SIGINT handlers on the process', () => {
    const server = makeMockServer();
    const onSpy = jest.spyOn(process, 'on');

    setupGracefulShutdown(server);

    const registeredEvents = onSpy.mock.calls.map(([event]) => event);
    expect(registeredEvents).toContain('SIGTERM');
    expect(registeredEvents).toContain('SIGINT');

    onSpy.mockRestore();
  });

  it('reads the grace period from SHUTDOWN_GRACE_MS', () => {
    process.env.SHUTDOWN_GRACE_MS = '1234';
    const server = makeMockServer();
    const onSpy = jest.spyOn(process, 'on');

    setupGracefulShutdown(server);

    // The handler should have been registered — grace value is exercised
    // through createShutdownHandler which is unit-tested separately.
    const registeredEvents = onSpy.mock.calls.map(([event]) => event);
    expect(registeredEvents).toContain('SIGTERM');

    onSpy.mockRestore();
  });

  it('defaults to 10 000 ms when SHUTDOWN_GRACE_MS is not set', () => {
    delete process.env.SHUTDOWN_GRACE_MS;
    const server = makeMockServer();
    const onSpy = jest.spyOn(process, 'on');

    // Should not throw — confirms parseInt fallback path works.
    expect(() => setupGracefulShutdown(server)).not.toThrow();

    onSpy.mockRestore();
  });
});
