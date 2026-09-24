import { describe, expect, it } from 'vitest';
import type { Measurement } from './contracts';
import { calcLiability, type LiabilityInput } from './liability';
import { checkQuality } from './quality';
import type { InterruptionRule, QualityRule, RegionPackage } from './regions';

const heatingQuality: QualityRule = {
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

const coldWaterInterruption: InterruptionRule = {
  id: 'cold_water.interruption',
  service: 'cold_water',
  title: 'Перерыв подачи холодной воды',
  source: { act: 'ПП РФ № 354', point: 'приложение 1, раздел I' },
  limits: { monthlyHours: 8, singleHours: 4, accidentSingleHours: 24 },
  reduction: { kind: 'per_hour', percent: 0.15 },
};

const hotWaterInterruption: InterruptionRule = {
  ...coldWaterInterruption,
  id: 'hot_water.interruption',
  service: 'hot_water',
  planned: { allowedDays: 14 },
};

const heatingInterruption: InterruptionRule = {
  id: 'heating.interruption',
  service: 'heating',
  title: 'Перерыв подачи отопления',
  source: { act: 'ПП РФ № 354', point: 'приложение 1, раздел VI' },
  limits: {
    monthlyHours: 24,
    singleHoursByIndoorTemperature: [
      { fromCelsius: 12, hours: 16 },
      { fromCelsius: 10, toCelsius: 12, hours: 8 },
      { fromCelsius: 8, toCelsius: 10, hours: 4 },
    ],
  },
  reduction: { kind: 'per_hour', percent: 0.15 },
};

const region: RegionPackage = {
  meta: {
    code: '16',
    name: 'Республика Татарстан',
    timezone: 'Europe/Moscow',
    asOf: '2026-09-23',
    rulesVersion: '2026.09.1',
    dataKind: 'model',
  },
  categories: [],
  tariffs: [
    {
      service: 'heating',
      unit: 'gcal',
      valueKopecks: 254612,
      validFrom: '2026-07-01',
      validTo: '2027-06-30',
      dataKind: 'model',
      source: { title: 'Решение тарифного органа' },
    },
    {
      service: 'cold_water',
      unit: 'm3',
      valueKopecks: 3520,
      validFrom: '2026-07-01',
      validTo: '2027-06-30',
      dataKind: 'model',
      source: { title: 'Решение тарифного органа' },
    },
    {
      service: 'hot_water',
      unit: 'm3',
      valueKopecks: 24180,
      validFrom: '2026-07-01',
      validTo: '2027-06-30',
      dataKind: 'model',
      source: { title: 'Решение тарифного органа' },
    },
  ],
  normatives: [
    {
      service: 'heating',
      unit: 'gcal_per_m2_month',
      value: 0.0189,
      dataKind: 'model',
      source: { title: 'Норматив' },
    },
    {
      service: 'cold_water',
      unit: 'm3_per_person_month',
      value: 5.51,
      dataKind: 'model',
      source: { title: 'Норматив' },
    },
    {
      service: 'hot_water',
      unit: 'm3_per_person_month',
      value: 3.29,
      dataKind: 'model',
      source: { title: 'Норматив' },
    },
  ],
  orgs: [],
  houses: [],
  executors: [],
};

const now = new Date('2026-11-09T12:00:00Z');
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

const base = (over: Partial<LiabilityInput> = {}): LiabilityInput => ({
  requestId: 'r-2026-0142',
  service: 'heating',
  startedAt: new Date('2026-11-09T06:00:00Z'),
  endedAt: null,
  billing: {},
  affectedApartments: 1,
  ...over,
});

describe('качество', () => {
  const verdict = checkQuality([m(15, '2026-11-09T06:00:00Z')], heatingQuality, {
    tz,
    until: now,
  });

  it('считает снижение от начисления из квитанции', () => {
    // 6 часов по 3 градуса = 18 градусо-часов, по 0,15 % от 3000 ₽.
    const result = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 } }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    expect(result.apartmentKopecks).toBe(8100);
    expect(result.hours).toBe(6);
  });

  it('без квитанции собирает плату из тарифа и норматива', () => {
    const result = calcLiability(
      base(),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    // 2546,12 ₽ × 0,0189 Гкал/м² × 50 м² = 2406 ₽ в месяц.
    const monthly = result.steps.find((s) => s.label === 'Плата за услугу за месяц');
    expect(monthly?.value).toBeCloseTo(2406.08, 1);
    expect(result.apartmentKopecks).toBeGreaterThan(0);
  });

  it('принятая площадь помечается моделью', () => {
    const result = calcLiability(
      base(),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    const area = result.steps.find((s) => s.label.startsWith('Площадь'));
    expect(area?.provenance).toBe('model');
  });

  it('оценка по дому растёт с числом присоединившихся', () => {
    const one = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 } }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    const many = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 }, affectedApartments: 14 }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    expect(many.houseKopecks).toBe(one.apartmentKopecks * 14);
    expect(many.apartmentKopecks).toBe(one.apartmentKopecks);
    expect(many.perHourHouseKopecks).toBeGreaterThan(one.perHourHouseKopecks);
  });

  it('оценка по дому всегда помечена моделью', () => {
    const result = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 }, affectedApartments: 5 }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    expect(result.steps.find((s) => s.label === 'Оценка по дому')?.provenance).toBe('model');
  });

  it('нет нарушения — нет денег', () => {
    const fine = checkQuality([m(19, '2026-11-09T06:00:00Z')], heatingQuality, { tz, until: now });
    const result = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 } }),
      { quality: { rule: heatingQuality, verdict: fine } },
      region,
      now,
    );
    expect(result.apartmentKopecks).toBe(0);
    expect(result.thresholdReachedAt).toBeNull();
  });

  it('снижение не превышает месячную плату', () => {
    const long = checkQuality([m(5, '2026-01-01T00:00:00Z')], heatingQuality, {
      tz,
      until: new Date('2026-03-01T00:00:00Z'),
    });
    const result = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 } }),
      { quality: { rule: heatingQuality, verdict: long } },
      region,
      now,
    );
    expect(result.apartmentKopecks).toBe(300_000);
    expect(result.steps.some((s) => s.label.includes('ограничено'))).toBe(true);
  });
});

describe('перерыв подачи', () => {
  it('до порога денег нет, но и нарушения нет', () => {
    const result = calcLiability(
      base({
        service: 'cold_water',
        startedAt: new Date('2026-11-09T09:00:00Z'),
        billing: { monthlyChargeKopecks: 50_000 },
      }),
      { interruption: { rule: coldWaterInterruption, measurements: [] } },
      region,
      now,
    );
    expect(result.apartmentKopecks).toBe(0);
    expect(result.thresholdReachedAt).toBeNull();
  });

  it('считаются только часы сверх допустимого', () => {
    // Перерыв 9 часов при допустимых 4: платят за 5.
    const result = calcLiability(
      base({
        service: 'cold_water',
        startedAt: new Date('2026-11-09T03:00:00Z'),
        billing: { monthlyChargeKopecks: 50_000 },
      }),
      { interruption: { rule: coldWaterInterruption, measurements: [] } },
      region,
      now,
    );
    expect(result.hours).toBe(5);
    expect(result.apartmentKopecks).toBe(375);
    expect(result.thresholdReachedAt).toBe('2026-11-09T07:00:00.000Z');
  });

  it('при аварии допустимый перерыв больше', () => {
    const result = calcLiability(
      base({
        service: 'cold_water',
        startedAt: new Date('2026-11-09T03:00:00Z'),
        billing: { monthlyChargeKopecks: 50_000 },
        accident: true,
      }),
      { interruption: { rule: coldWaterInterruption, measurements: [] } },
      region,
      now,
    );
    expect(result.apartmentKopecks).toBe(0);
  });

  it('израсходованный месячный лимит уменьшает допустимое время', () => {
    const result = calcLiability(
      base({
        service: 'cold_water',
        startedAt: new Date('2026-11-09T09:00:00Z'),
        billing: { monthlyChargeKopecks: 50_000 },
        priorHoursThisMonth: 7,
      }),
      { interruption: { rule: coldWaterInterruption, measurements: [] } },
      region,
      now,
    );
    // Из восьми часов в месяце остался один, перерыв длится три.
    expect(result.hours).toBe(2);
  });

  it('плановое отключение нарушением не является', () => {
    const result = calcLiability(
      base({
        service: 'hot_water',
        startedAt: new Date('2026-06-15T04:00:00Z'),
        billing: { monthlyChargeKopecks: 50_000 },
        plannedNotice: true,
      }),
      { interruption: { rule: hotWaterInterruption, measurements: [] } },
      region,
      new Date('2026-06-20T04:00:00Z'),
    );
    expect(result.apartmentKopecks).toBe(0);
    expect(result.steps[0]?.label).toContain('Плановое отключение');
  });

  it('для перерыва отопления допустимое время зависит от замера', () => {
    const warm = calcLiability(
      base({
        service: 'heating',
        startedAt: new Date('2026-11-09T00:00:00Z'),
        billing: { monthlyChargeKopecks: 300_000 },
      }),
      {
        interruption: { rule: heatingInterruption, measurements: [m(13, '2026-11-09T01:00:00Z')] },
      },
      region,
      now,
    );
    const cold = calcLiability(
      base({
        service: 'heating',
        startedAt: new Date('2026-11-09T00:00:00Z'),
        billing: { monthlyChargeKopecks: 300_000 },
      }),
      { interruption: { rule: heatingInterruption, measurements: [m(9, '2026-11-09T01:00:00Z')] } },
      region,
      now,
    );
    // При +13 допустимо 16 часов, при +9 — только 4.
    expect(warm.hours).toBe(0);
    expect(cold.hours).toBe(8);
  });

  it('перерыв отопления без замера считать отказывается', () => {
    expect(() =>
      calcLiability(
        base({ service: 'heating', billing: { monthlyChargeKopecks: 300_000 } }),
        { interruption: { rule: heatingInterruption, measurements: [] } },
        region,
        now,
      ),
    ).toThrow(/нужен замер/);
  });
});

describe('воспроизводимость', () => {
  it('в расчёт попадает версия правил', () => {
    const verdict = checkQuality([m(15, '2026-11-09T06:00:00Z')], heatingQuality, {
      tz,
      until: now,
    });
    const result = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 } }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    expect(result.rulesVersion).toBe('2026.09.1');
    expect(result.computedAt).toBe(now.toISOString());
  });

  it('каждый шаг несёт происхождение', () => {
    const verdict = checkQuality([m(15, '2026-11-09T06:00:00Z')], heatingQuality, {
      tz,
      until: now,
    });
    const result = calcLiability(
      base({ billing: { monthlyChargeKopecks: 300_000 } }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    for (const step of result.steps) {
      expect(['fact', 'calc', 'model']).toContain(step.provenance);
    }
  });

  it('деньги остаются целыми копейками', () => {
    const verdict = checkQuality([m(15, '2026-11-09T06:00:00Z')], heatingQuality, {
      tz,
      until: now,
    });
    const result = calcLiability(
      base({ affectedApartments: 7 }),
      { quality: { rule: heatingQuality, verdict } },
      region,
      now,
    );
    expect(Number.isInteger(result.apartmentKopecks)).toBe(true);
    expect(Number.isInteger(result.houseKopecks)).toBe(true);
    expect(Number.isInteger(result.perHourHouseKopecks)).toBe(true);
  });
});
