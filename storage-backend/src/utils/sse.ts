import { FastifyReply } from 'fastify';
import http from 'http';

export function setupSSE(reply: FastifyReply): void {
  reply.hijack();
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

export function sendSSEEvent(
  res: http.ServerResponse,
  event: string,
  data: unknown,
): void {
  if (res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function setupKeepAlive(
  res: http.ServerResponse,
  intervalMs = 15000,
): () => void {
  const timer = setInterval(() => {
    if (res.destroyed) {
      clearInterval(timer);
      return;
    }
    res.write(': keep-alive\n\n');
  }, intervalMs);

  return () => clearInterval(timer);
}
