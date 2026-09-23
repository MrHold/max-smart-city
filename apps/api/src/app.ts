import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { type Clock, systemClock } from '@msc/domain';
import Fastify from 'fastify';
import { type DataSource, demoData } from './data/demo';
import { ApiError } from './errors';
import { housesRoutes } from './routes/houses';
import { photosRoutes } from './routes/photos';
import type { Storage } from './storage';
import { diskStorage } from './storage/disk';

export interface AppOptions {
  data?: DataSource;
  storage?: Storage;
  clock?: Clock;
  corsOrigin?: string | boolean;
  logger?: boolean;
}

export function buildApp(opts: AppOptions = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1024 * 1024,
  });

  app.register(cors, {
    origin: opts.corsOrigin ?? true,
    allowedHeaders: ['Content-Type', 'X-Init-Data'],
  });
  app.register(multipart);

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    const status = typeof e.statusCode === 'number' && e.statusCode >= 400 ? e.statusCode : 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({
      error: {
        code: status >= 500 ? 'internal' : (e.code ?? 'bad_request'),
        message: status >= 500 ? 'Что-то пошло не так, попробуйте ещё раз' : (e.message ?? ''),
      },
    });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'Нет такого адреса' } }),
  );

  app.get('/api/health', async () => ({
    ok: true,
    now: (opts.clock ?? systemClock).now().toISOString(),
  }));

  app.register(housesRoutes(opts.data ?? demoData, opts.clock ?? systemClock));
  app.register(
    photosRoutes(opts.storage ?? diskStorage(process.env.PHOTOS_DIR ?? './data/photos')),
  );

  return app;
}
