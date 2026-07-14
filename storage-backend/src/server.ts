import { fastify } from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { initializeApp } from './app';
import { getCorsConfig } from './config/cors';
import { getLocalStoragePaths } from './utils/config';
import { getStorageLocations } from './utils/localStorage';

const PORT = parseInt(process.env.PORT || '8888', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const APP_ENV = process.env.APP_ENV || process.env.NODE_ENV;

const app = fastify({
  logger: {
    level: LOG_LEVEL,
    redact: [
      'err.response.request.headers.Authorization',
      'err.response.request.headers.authorization',
      'response.request.headers.Authorization',
      'response.request.headers.authorization',
      'request.headers.Authorization',
      'request.headers.authorization',
      'headers.Authorization',
      'headers.authorization',
      'req.headers.authorization',
      'req.headers.Authorization',
    ],
    ...(APP_ENV === 'development' && {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    }),
  },
  disableRequestLogging: true,
  pluginTimeout: 10000,
  maxParamLength: 2048,
});

app.addHook('onRequest', (request, _reply, done) => {
  if (request.url !== '/api' && request.url !== '/api/') {
    request.log.info(
      { method: request.method, url: request.url, remoteAddress: request.ip },
      'incoming request',
    );
  }
  done();
});

app.addHook('onResponse', (request, reply, done) => {
  if (request.url !== '/api' && request.url !== '/api/') {
    request.log.info(
      { statusCode: reply.statusCode, responseTime: reply.elapsedTime },
      'request completed',
    );
  }
  done();
});

app.register(cors, getCorsConfig());

app.register(helmet, {
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

app.register(fastifyMultipart);

app.register(initializeApp);

app.listen({ port: PORT, host: HOST }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }

  const corsConfig = getCorsConfig();
  app.log.info({ allowedOrigins: corsConfig.origin }, 'CORS configuration loaded');

  const localPaths = getLocalStoragePaths();
  app.log.info(
    { rawEnvVar: process.env.LOCAL_STORAGE_PATHS, parsedPaths: localPaths, pathCount: localPaths.length },
    'Local storage paths configuration',
  );

  getStorageLocations(app.log)
    .then((locations) => {
      const available = locations.filter((loc) => loc.available);
      const unavailable = locations.filter((loc) => !loc.available);
      if (available.length > 0) {
        app.log.info(
          { locations: available.map((loc) => ({ id: loc.id, path: loc.path })) },
          `${available.length} local storage location(s) available`,
        );
      }
      if (unavailable.length > 0) {
        app.log.warn(
          { locations: unavailable.map((loc) => ({ id: loc.id, path: loc.path })) },
          `${unavailable.length} local storage location(s) UNAVAILABLE`,
        );
      }
      if (locations.length === 0) {
        app.log.warn('No local storage locations configured');
      }
    })
    .catch((err) => {
      app.log.error({ err }, 'Failed to check local storage locations');
    });

  app.log.info(`Storage backend listening on ${HOST}:${PORT}`);
});

export default app;
