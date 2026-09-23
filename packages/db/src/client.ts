import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];
// Транзакция: то, что приходит в db.transaction(async (tx) => …)
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
// Везде, где функция работает и с db, и внутри транзакции
export type DbOrTx = Db | Tx;
