import { FastifyCorsOptions } from '@fastify/cors';

export function getCorsConfig(): FastifyCorsOptions {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['*'];

  return {
    origin: allowedOrigins,
    methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Disposition'],
    credentials: !allowedOrigins.includes('*'),
  };
}
