import { describe, expect, it } from 'vitest';
import type { Measurement } from './contracts';
import { checkQuality } from './quality';
import type { QualityRule } from './regions/schema';

const heating: QualityRule = {
  id: 'heating.indoor_temperature',
  service: 'heating',
  title: 'Температура воздуха в жилом помещении',
  places: ['room', 'corner_room'],
  source: { act: 'ПП РФ № 354', point: 'приложение 1, раздел VI' },
  norm: { celsius: 18, cornerRoomCelsius: 20 },
  tolerance: {
    night: { from: '00:00', to: '05:00', maxDeviationCelsius: 3 },
    day: { maxDeviationCelsius: 0 },
  },
  reduction: { kind: 'per_hour_per_degree', percent: 0.15 },
};

const hotWater: QualityRule = {
  id: 'hot_water.temperature',
  service: 'hot_water',
  title: 'Температура горячей воды в точке разбора',
  places: ['tap'],
  source: { act: 'ПП РФ № 354', point: 'приложение 1, раздел II' },
  norm: { celsius: 60, coldWaterFallbackBelowCelsius: 40 },
  tolerance: {
    night: { from: '00:00', to: '05:00', maxDeviationCelsius: 5 },
    day: { maxDeviationCelsius: 3 },
  },
  reduction: { kind: 'per_hour_per_step', stepCelsius: 3, percent: 0.1 },
};

const tz = 'Europe/Moscow';

const m = (
  value: number,
  measuredAt: string,
  place: Measurement['place'] = 'room',
): Measurement => ({
  value,
  unit: 'celsius',
  measuredAt,
  place,
});

describe('отопление', () => {
  it('днём отклонение не допускается', () => {
    // 09:00–13:00 по Москве, +15 при норме +18.
    const verdict = checkQuality([m(15, '2026-11-09T06:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T10:00:00Z'),
    });
    expect(verdict.violated).toBe(true);
    expect(verdict.violatingHours).toBe(4);
    expect(verdict.degreeHours).toBe(12);
    expect(verdict.worst?.deviation).toBe(3);
  });

  it('ночью допускается снижение на три градуса', () => {
    // 01:00–04:00 по Москве, +16: норма 18, ночью допустимо до 15.
    const verdict = checkQuality([m(16, '2026-11-08T22:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T01:00:00Z'),
    });
    expect(verdict.violated).toBe(false);
    expect(verdict.degreeHours).toBe(0);
  });

  it('ночное послабление не спасает при сильном отклонении', () => {
    const verdict = checkQuality([m(13, '2026-11-08T22:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T01:00:00Z'),
    });
    expect(verdict.violated).toBe(true);
    expect(verdict.worst?.deviation).toBe(2);
  });

  it('период разбивается на ночь и день по границе 05:00', () => {
    // 03:00–07:00 по Москве при +15: до 05:00 допустимо 15 — нарушения нет,
    // после 05:00 допустимо 18 — два часа нарушения по три градуса.
    const verdict = checkQuality([m(15, '2026-11-09T00:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T04:00:00Z'),
    });
    expect(verdict.violatingHours).toBe(2);
    expect(verdict.degreeHours).toBe(6);
    expect(verdict.segments).toHaveLength(2);
  });

  it('у угловой комнаты своя норма', () => {
    const verdict = checkQuality([m(19, '2026-11-09T06:00:00Z', 'corner_room')], heating, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.violated).toBe(true);
    expect(verdict.worst?.allowed).toBe(20);
  });

  it('в обычной комнате те же 19 градусов нарушением не являются', () => {
    const verdict = checkQuality([m(19, '2026-11-09T06:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.violated).toBe(false);
  });

  it('несколько замеров дают разные отрезки', () => {
    const verdict = checkQuality(
      [m(15, '2026-11-09T06:00:00Z'), m(17, '2026-11-09T08:00:00Z')],
      heating,
      { tz, until: new Date('2026-11-09T10:00:00Z') },
    );
    // Два часа по три градуса и два часа по одному.
    expect(verdict.degreeHours).toBe(8);
  });

  it('ровно на границе нормы нарушения нет', () => {
    const verdict = checkQuality([m(18, '2026-11-09T06:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.violated).toBe(false);
  });

  it('без замеров вердикт пустой', () => {
    const verdict = checkQuality([], heating, { tz, until: new Date('2026-11-09T07:00:00Z') });
    expect(verdict.violated).toBe(false);
    expect(verdict.segments).toHaveLength(0);
    expect(verdict.worst).toBeNull();
  });
});

describe('горячая вода', () => {
  it('отклонение считается шагами по три градуса', () => {
    // День, +48 при норме 60 и допуске 3: допустимо 57, отклонение 9 — это три шага.
    const verdict = checkQuality([m(48, '2026-11-09T06:00:00Z', 'tap')], hotWater, {
      tz,
      until: new Date('2026-11-09T08:00:00Z'),
    });
    expect(verdict.violated).toBe(true);
    expect(verdict.worst?.deviation).toBe(9);
    expect(verdict.stepHours).toBe(6);
  });

  it('неполный шаг не считается', () => {
    // Отклонение 5 градусов — это один полный шаг, а не полтора.
    const verdict = checkQuality([m(52, '2026-11-09T06:00:00Z', 'tap')], hotWater, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.stepHours).toBe(1);
  });

  it('ночью допуск больше', () => {
    // 01:00 по Москве, +56: допустимо 55.
    const verdict = checkQuality([m(56, '2026-11-08T22:00:00Z', 'tap')], hotWater, {
      tz,
      until: new Date('2026-11-08T23:00:00Z'),
    });
    expect(verdict.violated).toBe(false);
  });

  it('ниже сорока градусов включается оплата по холодной воде', () => {
    const verdict = checkQuality([m(38, '2026-11-09T06:00:00Z', 'tap')], hotWater, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.coldWaterFallback).toBe(true);
  });

  it('при норме порог оплаты по холодной воде не включается', () => {
    const verdict = checkQuality([m(58, '2026-11-09T06:00:00Z', 'tap')], hotWater, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.coldWaterFallback).toBe(false);
  });
});

describe('объяснение и ссылка', () => {
  it('вердикт всегда несёт ссылку на норму', () => {
    const verdict = checkQuality([m(15, '2026-11-09T06:00:00Z')], heating, {
      tz,
      until: new Date('2026-11-09T07:00:00Z'),
    });
    expect(verdict.ref.act).toBe('ПП РФ № 354');
    expect(verdict.ref.point).toContain('приложение 1');
    expect(verdict.explanation).toContain('18');
  });
});
