import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseFederalRules, parseRegionPackage, resolveCategories } from './parse';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string): unknown => parse(readFileSync(join(root, path), 'utf8'));

const rawRules = {
  quality: read('rules/federal/quality-354.yaml'),
  interruption: read('rules/federal/interruption-354.yaml'),
  deadlines: read('rules/federal/deadlines-416.yaml'),
};

const readRegion = (code: string) => ({
  meta: read(`regions/${code}/meta.yaml`),
  categories: read(`regions/${code}/categories.yaml`),
  tariffs: read(`regions/${code}/tariffs.yaml`),
  normatives: read(`regions/${code}/normatives.yaml`),
  orgs: read(`regions/${code}/orgs.yaml`),
  houses: read(`regions/${code}/houses.yaml`),
});

describe('федеральные правила', () => {
  const rules = parseFederalRules(rawRules);

  it('разбираются целиком', () => {
    expect(rules.quality.length).toBeGreaterThan(0);
    expect(rules.interruption.length).toBeGreaterThan(0);
    expect(rules.deadlines.length).toBeGreaterThan(0);
  });

  it('у каждого правила есть ссылка на норму', () => {
    for (const rule of [...rules.quality, ...rules.interruption]) {
      expect(rule.source.act, rule.id).toBeTruthy();
      expect(rule.source.point, rule.id).toBeTruthy();
    }
  });

  it('перерыв отопления зависит от температуры в квартире', () => {
    const heating = rules.interruption.find((r) => r.service === 'heating');
    expect(heating?.limits.singleHoursByIndoorTemperature?.length).toBeGreaterThan(0);
  });

  it('не принимает файлы с разошедшимися версиями', () => {
    const broken = {
      ...rawRules,
      deadlines: { ...(rawRules.deadlines as object), version: '0.0.0' },
    };
    expect(() => parseFederalRules(broken)).toThrow(/версии файлов разошлись/);
  });
});

describe('пакет региона 16', () => {
  const region = parseRegionPackage(readRegion('16-tatarstan'));

  it('разбирается целиком', () => {
    expect(region.meta.code).toBe('16');
    expect(region.houses.length).toBeGreaterThan(0);
    expect(region.orgs.length).toBeGreaterThan(0);
  });

  it('все дома ссылаются на существующие организации', () => {
    const ids = new Set(region.orgs.map((o) => o.id));
    for (const house of region.houses) expect(ids.has(house.orgId), house.id).toBe(true);
  });

  it('тарифы хранятся в целых копейках', () => {
    for (const t of region.tariffs) expect(Number.isInteger(t.valueKopecks), t.service).toBe(true);
  });

  it('каждое значение помечено происхождением', () => {
    for (const t of region.tariffs) expect(['official', 'model']).toContain(t.dataKind);
    for (const n of region.normatives) expect(['official', 'model']).toContain(n.dataKind);
  });

  it('ловит подмену региона в файле', () => {
    const raw = readRegion('16-tatarstan');
    const broken = { ...raw, tariffs: { ...(raw.tariffs as object), region: '77' } };
    expect(() => parseRegionPackage(broken)).toThrow(/не совпадает/);
  });

  it('ловит ссылку на несуществующую организацию', () => {
    const raw = readRegion('16-tatarstan');
    const houses = raw.houses as { region: string; items: Array<Record<string, unknown>> };
    const broken = {
      ...raw,
      houses: {
        ...houses,
        items: houses.items.map((h, i) => (i === 0 ? { ...h, orgId: 'org-нет' } : h)),
      },
    };
    expect(() => parseRegionPackage(broken)).toThrow(/неизвестную организацию/);
  });
});

describe('категории', () => {
  const rules = parseFederalRules(rawRules);
  const region = parseRegionPackage(readRegion('16-tatarstan'));
  const categories = resolveCategories(region, rules);

  it('срок берётся из нормы, а не задаётся в регионе', () => {
    const heating = categories.find((c) => c.code === 'heating');
    const rule = rules.deadlines.find((d) => d.id === 'ads.emergency');
    expect(heating?.slaHours).toBe(rule?.hours);
  });

  it('у ремонтных категорий нет услуги, у коммунальных есть', () => {
    for (const c of categories) {
      if (c.kind === 'repair') expect(c.service).toBeUndefined();
      else expect(c.service).toBeDefined();
    }
  });

  it('ловит категорию со ссылкой на несуществующий срок', () => {
    const broken = {
      ...region,
      categories: region.categories.map((c, i) => (i === 0 ? { ...c, slaRule: 'нет.такого' } : c)),
    };
    expect(() => resolveCategories(broken, rules)).toThrow(/неизвестный срок/);
  });

  it('ловит категорию качества без ссылки на норму', () => {
    const broken = {
      ...region,
      categories: region.categories.map((c) =>
        c.kind === 'utility_quality' ? { ...c, qualityRule: undefined } : c,
      ),
    };
    expect(() => resolveCategories(broken, rules)).toThrow(/нужна ссылка на норму/);
  });
});
