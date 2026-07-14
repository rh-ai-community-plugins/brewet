import { setupSSE, sendSSEEvent, setupKeepAlive } from '../../src/utils/sse';

function createMockReply(): any {
  const raw = {
    writeHead: jest.fn(),
    write: jest.fn(),
    destroyed: false,
  };
  return { raw };
}

function createMockResponse(): any {
  return {
    write: jest.fn(),
    destroyed: false,
  };
}

describe('setupSSE', () => {
  it('sets correct SSE headers', () => {
    const reply = createMockReply();
    setupSSE(reply);

    expect(reply.raw.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  });
});

describe('sendSSEEvent', () => {
  it('writes formatted SSE data', () => {
    const res = createMockResponse();
    sendSSEEvent(res, 'progress', { status: 'active', loaded: 50 });

    expect(res.write).toHaveBeenCalledWith(
      'event: progress\ndata: {"status":"active","loaded":50}\n\n',
    );
  });

  it('does not write to destroyed response', () => {
    const res = createMockResponse();
    res.destroyed = true;
    sendSSEEvent(res, 'progress', { test: true });

    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('setupKeepAlive', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends keep-alive comments at interval', () => {
    const res = createMockResponse();
    const cleanup = setupKeepAlive(res, 1000);

    jest.advanceTimersByTime(3000);
    expect(res.write).toHaveBeenCalledTimes(3);
    expect(res.write).toHaveBeenCalledWith(': keep-alive\n\n');

    cleanup();
  });

  it('stops on cleanup', () => {
    const res = createMockResponse();
    const cleanup = setupKeepAlive(res, 1000);

    jest.advanceTimersByTime(2000);
    expect(res.write).toHaveBeenCalledTimes(2);

    cleanup();

    jest.advanceTimersByTime(3000);
    expect(res.write).toHaveBeenCalledTimes(2);
  });

  it('auto-stops when response is destroyed', () => {
    const res = createMockResponse();
    setupKeepAlive(res, 1000);

    jest.advanceTimersByTime(1000);
    expect(res.write).toHaveBeenCalledTimes(1);

    res.destroyed = true;
    jest.advanceTimersByTime(1000);
    // Should not write because destroyed check fires
    expect(res.write).toHaveBeenCalledTimes(1);
  });
});
