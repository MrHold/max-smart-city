import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { Db } from '@msc/db';
import { type Clock, systemClock } from '@msc/domain';
import Fastify from 'fastify';
import { makeAuthenticate } from './auth/authenticate';
import type { AuthConfig } from './auth/config';
import type { DataSource } from './data/source';
import { ApiError } from './errors';
import { bindRoutes } from './routes/bind';
import { housesRoutes } from './routes/houses';
import { meRoutes } from './routes/me';
import { photosRoutes } from './routes/photos';
import type { Storage } from './storage';
import { diskStorage } from './storage/disk';

export interface AppOptions {
  data: DataSource;
  storage?: Storage;
  clock?: Clock;
  corsOrigin?: string | boolean;
  logger?: boolean;
  db?: Db;
  auth?: AuthConfig;
}

export function buildApp(opts: AppOptions) {
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

  const clock = opts.clock ?? systemClock;
  const authenticate =
    opts.db && opts.auth ? makeAuthenticate({ db: opts.db, config: opts.auth, clock }) : undefined;

  app.register(housesRoutes(opts.data, clock));
  app.register(
    photosRoutes(
      opts.storage ?? diskStorage(process.env.PHOTOS_DIR ?? './data/photos'),
      authenticate,
    ),
  );

  if (opts.db && authenticate) {
    app.register(meRoutes(opts.db, authenticate));
    app.register(bindRoutes(opts.db, authenticate));
  }

  return app;
}
