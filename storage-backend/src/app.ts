import path from 'path';
import fastifyAutoload from '@fastify/autoload';
import fastifySensible from '@fastify/sensible';
import { FastifyInstance } from 'fastify';

export const initializeApp = async (fastify: FastifyInstance): Promise<void> => {
  fastify.register(fastifySensible);

  // Health/liveness probe
  fastify.get('/api', async () => ({ status: 'ok' }));

  fastify.register(fastifyAutoload, {
    dir: path.join(__dirname, 'routes'),
    options: {},
  });
};
