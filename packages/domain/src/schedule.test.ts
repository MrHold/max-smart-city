import { describe, expect, it } from 'vitest';
import { isOpen } from './schedule';

const kazan = 'Europe/Moscow';
const office = { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
const night = { days: [1, 2, 3, 4, 5, 6, 7], from: '20:00', to: '08:00' };

// 2026-11-09 — понедельник
const at = (utc: string) => new Date(utc);

describe('isOpen', () => {
  it('офис открыт в рабочее время по местному времени, а не по UTC', () => {
    // 07:30Z = 10:30 в Казани
    expect(isOpen(office, kazan, at('2026-11-09T07:30:00Z'))).toEqual({
      isOpen: true,
      until: '18:00',
    });
    // 05:30Z = 08:30 — ещё закрыто
    expect(isOpen(office, kazan, at('2026-11-09T05:30:00Z'))).toEqual({
      isOpen: false,
      until: null,
    });
    // 15:00Z = 18:00 — уже закрыто, граница не включается
    expect(isOpen(office, kazan, at('2026-11-09T15:00:00Z'))).toEqual({
      isOpen: false,
      until: null,
    });
  });

  it('в выходной закрыто даже в рабочие часы', () => {
    // 2026-11-14 — суббота, 10:30 местного
    expect(isOpen(office, kazan, at('2026-11-14T07:30:00Z')).isOpen).toBe(false);
  });

  it('интервал через полночь открыт после старта и до конца следующим утром', () => {
    // 23:00 местного = 20:00Z
    expect(isOpen(night, kazan, at('2026-11-09T20:00:00Z')).isOpen).toBe(true);
    // 03:00 местного = 00:00Z следующих суток
    expect(isOpen(night, kazan, at('2026-11-10T00:00:00Z'))).toEqual({
      isOpen: true,
      until: '08:00',
    });
    // 12:00 местного = 09:00Z
    expect(isOpen(night, kazan, at('2026-11-10T09:00:00Z')).isOpen).toBe(false);
  });

  it('без расписания — круглосуточно', () => {
    expect(isOpen(null, kazan, at('2026-11-09T02:00:00Z'))).toEqual({ isOpen: true, until: null });
  });
});
