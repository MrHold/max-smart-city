import { type Db, demoClock, eq } from '@msc/db';

/**
 * Текущее время с учётом демо-сдвига. В демо-режиме API перематывает часы через таблицу
 * demo_clock — бот должен ставить отметки по тем же часам, иначе сроки разъедутся.
 */
export async function nowFor(db: Db, demoMode: boolean): Promise<Date> {
  if (!demoMode) return new Date();
  const [row] = await db
    .select({ offsetMs: demoClock.offsetMs })
    .from(demoClock)
    .where(eq(demoClock.id, 1))
    .limit(1);
  return new Date(Date.now() + (row?.offsetMs ?? 0));
}
