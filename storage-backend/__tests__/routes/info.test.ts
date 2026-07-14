import Fastify, { FastifyInstance } from 'fastify';
import infoRoutes from '../../src/routes/api/info/index';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.register(infoRoutes, { prefix: '/api/info' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/info', () => {
  it('returns app info', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/info' });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.app).toBe('brewet-storage-backend');
    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('version');
  });
});
