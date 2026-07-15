import rateLimit from 'express-rate-limit';
import { Request } from 'express';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 100;

const windowMs = (() => {
  const parsed = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10);
  return Number.isNaN(parsed) ? DEFAULT_WINDOW_MS : Math.max(1000, parsed);
})();

const max = (() => {
  const parsed = parseInt(process.env.RATE_LIMIT_MAX || '', 10);
  return Number.isNaN(parsed) ? DEFAULT_MAX : Math.max(1, parsed);
})();

export const rateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const namespace = req.params.namespace || 'global';
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `${ip}:${namespace}`;
  },
  message: { error: 'Too many requests. Please try again later.' },
});
