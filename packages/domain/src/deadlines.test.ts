import { describe, expect, it } from 'vitest';
import { type DeadlineContext, dueAt, hoursLeft } from './deadlines';
import type { DeadlineRule, WorkCalendar } from './regions/schema';

const calendar: WorkCalendar = {
  year: 2026,
  dataKind: 'model',
  holidays: ['2026-11-04'],
  workingWeekends: ['2026-11-14'],
};

const ctx: DeadlineContext = { calendar, tz: 'Europe/Moscow' };
const ctxYakutsk: DeadlineContext = { calendar, tz: 'Asia/Yakutsk' };

const emergency: DeadlineRule = {
  id: 'ads.emergency',
  title: 'Устранение аварийного повреждения',
  hours: 2,
  clock: 'calendar',
  dataKind: 'official',
};

const repairDay: DeadlineRule = {
  id: 'repair.day',
  title: 'Текущий ремонт',
  hours: 24,
  clock: 'working',
  dataKind: 'model',
};

const at = (iso: string) => new Date(iso);

describe('календарный срок', () => {
  it('прибавляется как есть, без оглядки на выходные', () => {
    // Суббота, 21:00 по Москве.
    const due = dueAt(at('2026-11-07T18:00:00Z'), emergency, ctx);
    expect(due.toISOString()).toBe('2026-11-07T20:00:00.000Z');
  });

  it('работает с получасом', () => {
    const half: DeadlineRule = { ...emergency, id: 'ads.localization', hours: 0.5 };
    const due = dueAt(at('2026-11-07T18:00:00Z'), half, ctx);
    expect(due.toISOString()).toBe('2026-11-07T18:30:00.000Z');
  });
});

describe('рабочий срок', () => {
  it('не течёт в выходные', () => {
    // Пятница 17:00 по Москве (14:00 UTC): до полуночи 7 часов,
    // суббота и воскресенье не считаются, оставшиеся 17 часов уходят на понедельник.
    const due = dueAt(at('2026-11-06T14:00:00Z'), repairDay, ctx);
    expect(due.toISOString()).toBe('2026-11-09T14:00:00.000Z');
  });

  it('внутри рабочей недели ведёт себя как обычные сутки', () => {
    const due = dueAt(at('2026-11-10T09:00:00Z'), repairDay, ctx);
    expect(due.toISOString()).toBe('2026-11-11T09:00:00.000Z');
  });

  it('пропускает праздник', () => {
    // 4 ноября — праздник, срок с 3 ноября переезжает на 5-е.
    const due = dueAt(at('2026-11-03T09:00:00Z'), repairDay, ctx);
    expect(due.toISOString()).toBe('2026-11-05T09:00:00.000Z');
  });

  it('учитывает рабочую субботу', () => {
    // 14 ноября объявлена рабочей, поэтому срок с пятницы не уезжает на понедельник.
    const due = dueAt(at('2026-11-13T09:00:00Z'), repairDay, ctx);
    expect(due.toISOString()).toBe('2026-11-14T09:00:00.000Z');
  });

  it('считает выходные по местному времени дома, а не сервера', () => {
    // Один и тот же момент: в Москве ещё пятница 21:00, в Якутске уже суббота 03:00.
    // В Москве успевают потратить 3 часа до полуночи, в Якутске срок не начинается вовсе,
    // зато местный понедельник наступает на 6 часов раньше по UTC.
    const started = at('2026-11-06T18:00:00Z');
    expect(dueAt(started, repairDay, ctx).toISOString()).toBe('2026-11-09T18:00:00.000Z');
    expect(dueAt(started, repairDay, ctxYakutsk).toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it('многодневный срок складывается из рабочих дней', () => {
    const week: DeadlineRule = { ...repairDay, id: 'repair.week', hours: 168 };
    // Семь рабочих суток с понедельника: суббота 14-го объявлена рабочей и считается,
    // воскресенье 15-го пропускается.
    const due = dueAt(at('2026-11-09T09:00:00Z'), week, ctx);
    expect(due.toISOString()).toBe('2026-11-17T09:00:00.000Z');
  });
});

describe('остаток времени', () => {
  const due = at('2026-11-08T12:00:00Z');

  // Проверку «просрочено ли» см. workflow.test.ts: там isOverdue учитывает endedAt.
  it('остаток времени считается со знаком', () => {
    expect(hoursLeft(due, at('2026-11-08T10:00:00Z'))).toBe(2);
    expect(hoursLeft(due, at('2026-11-08T15:00:00Z'))).toBe(-3);
  });
});
