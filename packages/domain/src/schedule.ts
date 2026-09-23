import type { Schedule } from './contracts';

export interface OpenStatus {
  isOpen: boolean;
  /** Время закрытия «HH:MM» по местному времени дома, если сейчас открыто. */
  until: string | null;
}

const weekday: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function localParts(now: Date, tz: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: weekday[get('weekday')] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const toMinutes = (hhmm: string): number => {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

const prevDay = (d: number) => (d === 1 ? 7 : d - 1);

/**
 * Открыт ли контакт сейчас. Расписание задано в местном времени дома, `now` — любой момент в UTC.
 * Интервал через полночь (например, 20:00–08:00) считается частью дня, в который он начался.
 */
export function isOpen(schedule: Schedule | null, tz: string, now: Date): OpenStatus {
  if (!schedule) return { isOpen: true, until: null };
  const { day, minutes } = localParts(now, tz);
  const from = toMinutes(schedule.from);
  const to = toMinutes(schedule.to);

  if (from < to) {
    const open = schedule.days.includes(day) && minutes >= from && minutes < to;
    return { isOpen: open, until: open ? schedule.to : null };
  }

  const startedToday = schedule.days.includes(day) && minutes >= from;
  const startedYesterday = schedule.days.includes(prevDay(day)) && minutes < to;
  const open = startedToday || startedYesterday;
  return { isOpen: open, until: open ? schedule.to : null };
}
