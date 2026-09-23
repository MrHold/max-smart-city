import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL не задан');
  process.exit(1);
}

const { db, pool } = createDb(url);
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

await migrate(db, { migrationsFolder });
console.log('Миграции применены');
await pool.end();
