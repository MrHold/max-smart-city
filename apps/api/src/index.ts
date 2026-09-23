import { createDb } from '@msc/db';
import { buildApp } from './app';
import { authConfigFromEnv } from './auth/config';

const port = Number(process.env.API_PORT ?? 3001);
const corsOrigin = process.env.CORS_ORIGIN ?? true;

const databaseUrl = process.env.DATABASE_URL;
const db = databaseUrl ? createDb(databaseUrl).db : undefined;
const auth = authConfigFromEnv();

const app = buildApp({ logger: true, corsOrigin, db, auth: auth.ok ? auth.config : undefined });

if (!db || !auth.ok) {
  const missing = [...(db ? [] : ['DATABASE_URL']), ...(auth.ok ? [] : auth.missing)];
  app.log.warn(`Вход через MAX выключен (не заданы: ${missing.join(', ')}) — /api/me недоступен`);
}

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
