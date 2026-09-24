import { type Db, demoClock as demoClockTable, eq } from '@msc/db';
import { type Clock, systemClock } from '@msc/domain';

/**
 * Часы, которые можно перемотать на защите.
 *
 * Сдвиг лежит в базе одной строкой, поэтому его видят все процессы: API считает по нему
 * просрочку и суммы, бот — сроки уведомлений. В памяти держится копия, потому что
 * Clock.now() синхронный; копия обновляется раз в секунду и сразу после изменения.
 */
export interface DemoClock extends Clock {
  /**
   * Настоящее время, без сдвига. По нему проверяется свежесть входа: иначе перемотка
   * вперёд «состарила» бы подпись initData и выбросила пользователя из приложения.
   */
  baseNow(): Date;
  offsetMs(): number;
  refresh(): Promise<number>;
  set(offsetMs: number): Promise<number>;
  shift(deltaMs: number): Promise<number>;
  stop(): void;
}

export function createDemoClock(db: Db, base: Clock = systemClock, refreshMs = 1000): DemoClock {
  let offset = 0;

  const read = async (): Promise<number> => {
    const [row] = await db
      .select({ offsetMs: demoClockTable.offsetMs })
      .from(demoClockTable)
      .where(eq(demoClockTable.id, 1))
      .limit(1);
    return row?.offsetMs ?? 0;
  };

  const write = async (value: number): Promise<number> => {
    await db
      .insert(demoClockTable)
      .values({ id: 1, offsetMs: value, updatedAt: base.now() })
      .onConflictDoUpdate({
        target: demoClockTable.id,
        set: { offsetMs: value, updatedAt: base.now() },
      });
    offset = value;
    return value;
  };

  // Таймер не должен держать процесс: без unref тесты и graceful shutdown зависли бы.
  const timer = setInterval(() => {
    void read().then((value) => {
      offset = value;
    });
  }, refreshMs);
  timer.unref?.();

  return {
    now: () => new Date(base.now().getTime() + offset),
    baseNow: () => base.now(),
    offsetMs: () => offset,
    refresh: async () => {
      offset = await read();
      return offset;
    },
    set: write,
    shift: async (deltaMs) => write((await read()) + deltaMs),
    stop: () => clearInterval(timer),
  };
}
