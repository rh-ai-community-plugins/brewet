import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 100;

const windowMs = (() => {
  const parsed = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10);
  return Number.isNaN(parsed) ? DEFAULT_WINDOW_MS : Math.max(1000, parsed);
})();

const limit = (() => {
  const parsed = parseInt(process.env.RATE_LIMIT_MAX || '', 10);
  return Number.isNaN(parsed) ? DEFAULT_MAX : Math.max(1, parsed);
})();

export const rateLimiter = rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const namespace = req.params.namespace || 'global';
    const rawIp = req.socket.remoteAddress || 'unknown';
    return `${ipKeyGenerator(rawIp)}:${namespace}`;
  },
  message: {
    error: 'Too Many Requests',
    detail: 'Rate limit exceeded for this namespace. Please slow down.',
  },
});
