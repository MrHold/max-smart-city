import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@msc/db';
import { type Clock, systemClock } from '@msc/domain';
import Fastify from 'fastify';
import { makeAuthenticate } from './auth/authenticate';
import type { AuthConfig } from './auth/config';
import type { DemoClock } from './clock/demo';
import type { RegionsData } from './data/regions';
import type { DataSource } from './data/source';
import { ApiError } from './errors';
import { bindRoutes } from './routes/bind';
import { demoRoutes } from './routes/demo';
import { dispatcherRoutes } from './routes/dispatcher';
import { documentsRoutes } from './routes/documents';
import { housesRoutes } from './routes/houses';
import { meRoutes } from './routes/me';
import { photosRoutes } from './routes/photos';
import { privacyRoutes } from './routes/privacy';
import { requestsRoutes } from './routes/requests';
import type { Storage } from './storage';
import { diskStorage } from './storage/disk';

export interface AppOptions {
  data: DataSource;
  /** Правила и пакеты регионов: нужны заявкам для сроков, вердикта и расчёта. */
  regions?: RegionsData;
  storage?: Storage;
  clock?: Clock;
  corsOrigin?: string | string[] | boolean;
  logger?: boolean;
  db?: Db;
  auth?: AuthConfig;
}

/** Демо-часы отличаются от обычных умением сдвигаться: только для них есть маршруты перемотки. */
const isDemoClock = (clock: Clock): clock is DemoClock =>
  typeof (clock as DemoClock).shift === 'function';

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

  // Ограничение частоты: один вошедший пользователь не должен залить базу заявками
  // или фотографиями. Считаем по пользователю, а не по адресу — за одним домашним
  // роутером могут сидеть несколько жителей.
  app.register(rateLimit, {
    global: true,
    max: Number(process.env.RATE_LIMIT_MAX ?? 120),
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
    errorResponseBuilder: () => ({
      error: { code: 'too_many_requests', message: 'Слишком много запросов, подождите минуту' },
    }),
  });

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
  // Свежесть входа считается по настоящему времени: перемотка демо-часов вперёд
  // не должна «состаривать» подпись initData и выбрасывать человека из приложения.
  const authClock: Clock = isDemoClock(clock) ? { now: () => clock.baseNow() } : clock;
  const authenticate =
    opts.db && opts.auth
      ? makeAuthenticate({ db: opts.db, config: opts.auth, clock: authClock })
      : undefined;

  app.register(housesRoutes(opts.data, clock));
  app.register(
    photosRoutes(
      opts.storage ?? diskStorage(process.env.PHOTOS_DIR ?? './data/photos'),
      authenticate,
      opts.db,
    ),
  );

  if (opts.db && authenticate && opts.auth) {
    const secret = opts.auth.hashSecret;
    app.register(meRoutes(opts.db, authenticate));
    app.register(bindRoutes(opts.db, authenticate));
    app.register(privacyRoutes(opts.db, clock, authenticate));
    if (opts.regions) {
      app.register(requestsRoutes(opts.db, opts.regions, clock, authenticate, secret));
      app.register(dispatcherRoutes(opts.db, opts.regions, clock, authenticate));
      // Тем же секретом подписываются временные ссылки на документы: отдельная
      // переменная окружения ради этого не нужна, ключ всё равно серверный.
      app.register(documentsRoutes(opts.db, opts.regions, clock, authenticate, secret));
    }
    if (isDemoClock(clock)) {
      app.register(demoRoutes(clock, authenticate));
      app.addHook('onClose', async () => clock.stop());
    }
  }

  return app;
}
