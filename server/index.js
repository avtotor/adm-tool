import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyView from '@fastify/view';
import fastifyFormbody from '@fastify/formbody';
import ejs from 'ejs';

import { init as initStore } from './store.js';
import apiRoutes from './routes/api.js';
import adminRoutes from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(process.env.PORT ?? 8080);

async function main() {
  await initStore();

  const app = Fastify({
    logger: true,
    bodyLimit: 512 * 1024 * 1024,
  });

  await app.register(fastifyFormbody);
  await app.register(fastifyMultipart, {
    limits: { fileSize: 512 * 1024 * 1024 },
  });

  await app.register(fastifyView, {
    engine: { ejs },
    root: path.join(__dirname, 'views'),
    propertyName: 'view',
  });

  await app.register(fastifyStatic, {
    root: path.resolve('public'),
    prefix: '/static/',
    decorateReply: false,
  });

  await app.register(apiRoutes, { prefix: '/api' });
  await app.register(adminRoutes);

  app.get('/health', async () => ({ ok: true }));

  try {
    await app.listen({ host: HOST, port: PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
