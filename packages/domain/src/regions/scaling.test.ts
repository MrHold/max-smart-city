import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { dueAt } from '../deadlines';
import { calcLiability } from '../liability';
import { checkQuality } from '../quality';
import { parseFederalRules, parseRegionPackage, resolveCategories } from './parse';

/**
 * Подключение региона — это добавление каталога с данными, а не правка кода.
 * Тест прогоняет один и тот же сценарий на двух регионах: результаты обязаны
 * различаться, и различаться только из-за данных.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string): unknown => parse(readFileSync(join(root, path), 'utf8'));

const rules = parseFederalRules({
  quality: read('rules/federal/quality-354.yaml'),
  interruption: read('rules/federal/interruption-354.yaml'),
  deadlines: read('rules/federal/deadlines-416.yaml'),
  calendar: read('rules/federal/calendar-2026.yaml'),
});

const region = (dir: string) =>
  parseRegionPackage({
    meta: read(`regions/${dir}/meta.yaml`),
    categories: read(`regions/${dir}/categories.yaml`),
    tariffs: read(`regions/${dir}/tariffs.yaml`),
    normatives: read(`regions/${dir}/normatives.yaml`),
    orgs: read(`regions/${dir}/orgs.yaml`),
    houses: read(`regions/${dir}/houses.yaml`),
    executors: read(`regions/${dir}/executors.yaml`),
  });

const kazan = region('16-tatarstan');
const moscow = region('77-moscow');

const STARTED = new Date('2026-11-10T03:30:00Z');
const NOW = new Date('2026-11-10T09:30:00Z');

/** Один и тот же случай: шесть часов при +15 °C вместо нормы. */
const heatingCase = (pkg: typeof kazan) => {
  const rule = rules.quality.find((r) => r.id === 'heating.indoor_temperature');
  if (!rule) throw new Error('нет правила качества отопления');

  const verdict = checkQuality(
    [{ value: 15, unit: 'celsius', measuredAt: STARTED.toISOString(), place: 'room' }],
    rule,
    { tz: pkg.meta.timezone, until: NOW },
  );

  return calcLiability(
    {
      requestId: 'r-test',
      service: 'heating',
      startedAt: STARTED,
      endedAt: null,
      billing: {},
      affectedApartments: 1,
    },
    { quality: { rule, verdict } },
    pkg,
    NOW,
  );
};

describe('второй регион', () => {
  it('оба пакета разбираются одними и теми же схемами', () => {
    expect(kazan.meta.code).toBe('16');
    expect(moscow.meta.code).toBe('77');
    expect(moscow.houses.length).toBeGreaterThan(0);
    expect(moscow.executors.length).toBeGreaterThan(0);
  });

  it('сумма перерасчёта зависит от региона, а не от кода', () => {
    const inKazan = heatingCase(kazan);
    const inMoscow = heatingCase(moscow);

    // Нарушение одинаковое: шесть часов по три градуса.
    expect(inKazan.hours).toBe(inMoscow.hours);
    // Деньги разные: другой тариф и другой норматив.
    expect(inMoscow.apartmentKopecks).not.toBe(inKazan.apartmentKopecks);
    expect(inKazan.apartmentKopecks).toBeGreaterThan(0);
    expect(inMoscow.apartmentKopecks).toBeGreaterThan(0);
  });

  it('федеральные нормы общие: версия правил в расчёте одна', () => {
    expect(heatingCase(kazan).rulesVersion).toBe(heatingCase(moscow).rulesVersion);
  });

  it('набор категорий и сроки — региональные', () => {
    const inKazan = resolveCategories(kazan, rules);
    const inMoscow = resolveCategories(moscow, rules);

    // В Москве есть мусоропровод, в Казани — детская площадка.
    expect(inMoscow.some((c) => c.code === 'garbage_chute')).toBe(true);
    expect(inKazan.some((c) => c.code === 'playground')).toBe(true);

    // Одна и та же категория может иметь разный срок в разных регионах.
    const door = (list: typeof inKazan) => list.find((c) => c.code === 'entrance_door')?.slaHours;
    expect(door(inKazan)).not.toBe(door(inMoscow));
  });

  it('срок считается по региональной ссылке на норму', () => {
    const forRegion = (pkg: typeof kazan) => {
      const category = pkg.categories.find((c) => c.code === 'cold_water_off');
      const rule = rules.deadlines.find((d) => d.id === category?.slaRule);
      if (!rule) throw new Error('нет срока');
      return dueAt(STARTED, rule, { calendar: rules.calendar, tz: pkg.meta.timezone });
    };

    // В Казани категория ссылается на устранение аварии, в Москве — на локализацию.
    expect(forRegion(moscow).getTime()).toBeLessThan(forRegion(kazan).getTime());
  });

  it('у всех значений обоих регионов указано происхождение', () => {
    for (const pkg of [kazan, moscow]) {
      for (const t of pkg.tariffs) expect(['official', 'model']).toContain(t.dataKind);
      for (const n of pkg.normatives) expect(['official', 'model']).toContain(n.dataKind);
      for (const h of pkg.houses) expect(['official', 'model']).toContain(h.dataKind);
    }
  });
});
