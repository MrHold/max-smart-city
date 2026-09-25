import { and, type Db, enqueueNotification, eq, lte, requestEvents, requests } from '@msc/db';
import { AUTO_CLOSE_DAYS, autoCloseThreshold, type Clock, transition } from '@msc/domain';

export interface AutoCloseResult {
  closed: number;
}

/**
 * Закрывает выполненные заявки, которые житель так и не подтвердил.
 *
 * Гонка с самим жителем безопасна: обновление идёт с условием `status = 'done'`,
 * поэтому если человек подтвердил или вернул работу за долю секунды до нас, строка
 * просто не попадёт под обновление и мы её пропустим.
 *
 * Событие пишется как обычное «подтверждено» с пометкой `auto`: так таймлайн в интерфейсе
 * дорисует последний шаг без отдельной ветки, а подпись выбирается по пометке.
 */
export async function closeStaleRequests(
  db: Db,
  clock: Clock,
  days = AUTO_CLOSE_DAYS,
): Promise<AutoCloseResult> {
  const now = clock.now();

  const stale = await db
    .select({ id: requests.id, number: requests.number, authorUserId: requests.authorUserId })
    .from(requests)
    .where(and(eq(requests.status, 'done'), lte(requests.endedAt, autoCloseThreshold(now, days))));

  let closed = 0;

  for (const row of stale) {
    await db.transaction(async (tx) => {
      const next = transition('done', 'confirm');

      const updated = await tx
        .update(requests)
        .set({ status: next, updatedAt: now })
        .where(and(eq(requests.id, row.id), eq(requests.status, 'done')))
        .returning({ id: requests.id });

      if (updated.length === 0) return;

      await tx.insert(requestEvents).values({
        requestId: row.id,
        type: 'confirmed',
        actorUserId: null,
        payload: { auto: true, afterDays: days },
        at: now,
      });

      await enqueueNotification(tx, row.authorUserId, {
        type: 'auto_closed',
        requestId: row.id,
        number: row.number,
        afterDays: days,
      });

      closed += 1;
    });
  }

  return { closed };
}

/** Запускает проверку раз в интервал. Возвращает функцию остановки. */
export function startAutoClose(
  db: Db,
  clock: Clock,
  log: { info: (msg: string) => void; error: (err: unknown) => void },
  intervalMs = 60_000,
): () => void {
  let busy = false;

  const tick = async () => {
    // Предыдущий прогон мог не закончиться: второй параллельно не запускаем.
    if (busy) return;
    busy = true;
    try {
      const { closed } = await closeStaleRequests(db, clock);
      if (closed > 0) log.info(`Автозакрытие: закрыто заявок — ${closed}`);
    } catch (err) {
      log.error(err);
    } finally {
      busy = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();

  return () => clearInterval(timer);
}
