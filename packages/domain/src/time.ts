/**
 * Работа с местным временем дома. Всё, что приходит и уходит наружу, — UTC,
 * но ночные послабления и выходные считаются по часовому поясу дома,
 * а не по времени сервера.
 *
 * Перевод часов в России не применяется, поэтому смещение внутри суток
 * считается постоянным.
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export interface LocalDay {
  /** Дата по местному времени в формате YYYY-MM-DD. */
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

export function localDay(at: Date, tz: string): LocalDay {
  const p = parts(at, tz);
  return {
    key: `${p.year}-${p.month}-${p.day}`,
    weekday: weekdays[p.weekday ?? ''] ?? 0,
  };
}

/** Смещение часового пояса в этот момент, в миллисекундах. */
export function offsetMs(at: Date, tz: string): number {
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

/** Минуты, прошедшие с местной полуночи. */
export function localMinutes(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

/** Ближайшая местная полночь после указанного момента. */
export function nextLocalMidnight(at: Date, tz: string): Date {
  const offset = offsetMs(at, tz);
  const local = new Date(at.getTime() + offset);
  const startOfNext = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  const guess = new Date(startOfNext - offset);
  const corrected = new Date(startOfNext - offsetMs(guess, tz));
  return corrected.getTime() > at.getTime() ? corrected : new Date(at.getTime() + DAY_MS);
}

export const toMinutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

/** Ближайший момент после `at`, когда местные часы покажут указанное время. */
export function nextLocalTime(at: Date, tz: string, hhmm: string): Date {
  const current = localMinutes(at, tz);
  const target = toMinutes(hhmm);
  const deltaMinutes = target > current ? target - current : target - current + 1440;
  return new Date(at.getTime() + deltaMinutes * 60_000);
}
