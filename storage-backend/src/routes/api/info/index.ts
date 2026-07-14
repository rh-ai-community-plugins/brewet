import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const APP_VERSION = process.env.APP_VERSION || '0.0.0';

export default async (fastify: FastifyInstance): Promise<void> => {
  fastify.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      app: 'brewet-storage-backend',
      version: APP_VERSION,
      status: 'ok',
    });
  });
};
