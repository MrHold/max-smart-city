import type { DeadlineRule, WorkCalendar } from './regions/schema';
import { HOUR_MS, type LocalDay, localDay, nextLocalMidnight } from './time';

export function isWorkingDay(day: LocalDay, calendar: WorkCalendar): boolean {
  if (calendar.holidays.includes(day.key)) return false;
  if (calendar.workingWeekends.includes(day.key)) return true;
  return day.weekday >= 1 && day.weekday <= 5;
}

export interface DeadlineContext {
  calendar: WorkCalendar;
  /** Часовой пояс дома: выходные считаются по местному времени, а не по времени сервера. */
  tz: string;
}

/**
 * Момент, к которому заявка должна быть закрыта.
 *
 * Календарный срок прибавляется напрямую. Рабочий срок расходуется только в рабочие дни:
 * часы, попавшие на выходной или праздник, не тратятся, и заявка не «просрочивается»,
 * пока УК не работает. Первый неполный день учитывается целиком — от момента подачи
 * до местной полуночи.
 */
export function dueAt(startedAt: Date, rule: DeadlineRule, ctx: DeadlineContext): Date {
  if (rule.clock === 'calendar') {
    return new Date(startedAt.getTime() + rule.hours * HOUR_MS);
  }

  let remainingMs = rule.hours * HOUR_MS;
  let cursor = startedAt;

  // Ограничение защищает от зацикливания на календаре, где рабочих дней нет вовсе.
  for (let guard = 0; guard < 400; guard += 1) {
    const midnight = nextLocalMidnight(cursor, ctx.tz);
    if (isWorkingDay(localDay(cursor, ctx.tz), ctx.calendar)) {
      const available = midnight.getTime() - cursor.getTime();
      if (remainingMs <= available) return new Date(cursor.getTime() + remainingMs);
      remainingMs -= available;
    }
    cursor = midnight;
  }

  throw new Error(
    `Не удалось посчитать срок ${rule.id}: в календаре ${ctx.calendar.year} не нашлось рабочих дней`,
  );
}

// Проверку «просрочено ли» см. isOverdue в workflow.ts: там же учитывается endedAt —
// заявка, закрытая в срок, не должна задним числом становиться просроченной.

/** Сколько осталось до срока. Отрицательное значение — на столько просрочено. */
export const hoursLeft = (due: Date, now: Date): number =>
  (due.getTime() - now.getTime()) / HOUR_MS;
