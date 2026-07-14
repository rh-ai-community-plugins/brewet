import http from 'http';

const DEFAULT_GRACE_MS = 10_000;

export function createShutdownHandler(
  server: http.Server,
  graceMs: number,
): (signal: string) => void {
  return function shutdown(signal: string): void {
    console.log(`[BFF] Received ${signal}. Shutting down gracefully (grace=${graceMs}ms)...`);

    server.close((err) => {
      if (err) {
        console.error('[BFF] Error during graceful shutdown:', err.message);
        process.exit(1);
      }
      console.log('[BFF] All connections closed. Exiting cleanly.');
      process.exit(0);
    });

    const timer = setTimeout(() => {
      console.error(
        `[BFF] Graceful shutdown timed out after ${graceMs}ms. Forcing exit.`,
      );
      process.exit(1);
    }, graceMs);

    timer.unref();
  };
}

export function setupGracefulShutdown(server: http.Server): void {
  const parsed = parseInt(process.env.SHUTDOWN_GRACE_MS || '', 10);
  const graceMs = Number.isNaN(parsed) ? DEFAULT_GRACE_MS : Math.max(0, parsed);

  const shutdown = createShutdownHandler(server, graceMs);

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
