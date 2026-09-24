import { createDb } from '@msc/db';
import { buildApp } from './app';
import { authConfigFromEnv } from './auth/config';
import { loadRegionsData, regionsDataSource } from './data/regions';
import { seedFromRegions } from './data/seed';

const port = Number(process.env.API_PORT ?? 3001);
const corsOrigin = process.env.CORS_ORIGIN ?? true;

const databaseUrl = process.env.DATABASE_URL;
const db = databaseUrl ? createDb(databaseUrl).db : undefined;
const auth = authConfigFromEnv();

const regions = await loadRegionsData();
const data = regionsDataSource(regions);

const app = buildApp({
  logger: true,
  corsOrigin,
  data,
  db,
  auth: auth.ok ? auth.config : undefined,
});

app.log.info(
  `Регионы: ${regions.regions.map((r) => `${r.meta.code} (${r.houses.length} домов)`).join(', ')}, правила ${regions.rules.version}`,
);

if (db) {
  const seeded = await seedFromRegions(db, regions);
  app.log.info(
    `Дома и организации из regions/ в БД: ${seeded.houses} домов, ${seeded.orgs} организаций`,
  );
}

if (!db || !auth.ok) {
  const missing = [...(db ? [] : ['DATABASE_URL']), ...(auth.ok ? [] : auth.missing)];
  app.log.warn(`Вход через MAX выключен (не заданы: ${missing.join(', ')}) — /api/me недоступен`);
}

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
