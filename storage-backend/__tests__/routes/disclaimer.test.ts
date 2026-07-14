import Fastify, { FastifyInstance } from 'fastify';
import disclaimerRoutes from '../../src/routes/api/disclaimer/index';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(disclaimerRoutes, { prefix: '/api/disclaimer' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/disclaimer', () => {
  it('returns app info', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/disclaimer' });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.app).toBe('brewet-storage-backend');
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('version');
  });
});
