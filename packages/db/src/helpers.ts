import { sql } from 'drizzle-orm';
import type { DbOrTx } from './client';
import { outbox } from './schema';

/** Следующий номер заявки вида «2026-0142». Уникален даже при одновременных заявках. */
export async function nextRequestNumber(db: DbOrTx, year: number): Promise<string> {
  const res = await db.execute<{ n: string }>(sql`select nextval('request_number_seq') as n`);
  const n = res.rows[0]?.n;
  if (n === undefined) throw new Error('request_number_seq не вернула значение');
  return `${year}-${n.padStart(4, '0')}`;
}

/**
 * Поставить уведомление в очередь. Вызывать ВНУТРИ той же транзакции, что и смена статуса:
 * db.transaction(async (tx) => { …update requests…; await enqueueNotification(tx, …) })
 */
export async function enqueueNotification(tx: DbOrTx, userId: string, payload: unknown) {
  await tx.insert(outbox).values({ userId, payload });
}
