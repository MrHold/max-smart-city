import type { DeadlineRule, WorkCalendar } from './regions/schema';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface LocalDay {
  /** Дата по местному времени дома в формате YYYY-MM-DD. */
  key: string;
  /** День недели по ISO: 1 — понедельник, 7 — воскресенье. */
  weekday: number;
}

const weekdays: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  const cached = formatters.get(tz);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  formatters.set(tz, created);
  return created;
}

function parts(at: Date, tz: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(at)) result[p.type] = p.value;
  return result;
}

function localDay(at: Date, tz: string): LocalDay {
  const p = parts(at, tz);
  return {
    key: `${p.year}-${p.month}-${p.day}`,
    weekday: weekdays[p.weekday ?? ''] ?? 0,
  };
}

/** Смещение часового пояса в этот момент, в миллисекундах. */
function offsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - at.getTime();
}

/** Ближайшая местная полночь после указанного момента. */
function nextLocalMidnight(at: Date, tz: string): Date {
  const offset = offsetMs(at, tz);
  const local = new Date(at.getTime() + offset);
  const startOfNext = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  const guess = new Date(startOfNext - offset);
  // Пересчёт на случай перевода часов между этими моментами.
  const corrected = new Date(startOfNext - offsetMs(guess, tz));
  return corrected.getTime() > at.getTime() ? corrected : new Date(at.getTime() + DAY_MS);
}

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

export const isOverdue = (due: Date, now: Date): boolean => now.getTime() > due.getTime();

/** Сколько осталось до срока. Отрицательное значение — на столько просрочено. */
export const hoursLeft = (due: Date, now: Date): number =>
  (due.getTime() - now.getTime()) / HOUR_MS;
