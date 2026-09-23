import type * as z from 'zod';
import type { Category } from '../contracts/house';
import type {
  DeadlineRule,
  InterruptionRule,
  Normative,
  QualityRule,
  RegionCategory,
  RegionHouse,
  RegionMeta,
  RegionOrg,
  Tariff,
} from './schema';
import {
  DeadlineRulesFileSchema,
  InterruptionRulesFileSchema,
  QualityRulesFileSchema,
  RegionCategoriesFileSchema,
  RegionHousesFileSchema,
  RegionMetaSchema,
  RegionNormativesFileSchema,
  RegionOrgsFileSchema,
  RegionTariffsFileSchema,
} from './schema';

export interface FederalRules {
  version: string;
  quality: QualityRule[];
  interruption: InterruptionRule[];
  deadlines: DeadlineRule[];
}

export interface RegionPackage {
  meta: RegionMeta;
  categories: RegionCategory[];
  tariffs: Tariff[];
  normatives: Normative[];
  orgs: RegionOrg[];
  houses: RegionHouse[];
}

/** Сырые данные одного пакета: разобранный YAML приходит снаружи, файлы читает приложение. */
export interface RawFederalRules {
  quality: unknown;
  interruption: unknown;
  deadlines: unknown;
}

export interface RawRegionPackage {
  meta: unknown;
  categories: unknown;
  tariffs: unknown;
  normatives: unknown;
  orgs: unknown;
  houses: unknown;
}

function parseFile<T>(schema: z.ZodType<T>, raw: unknown, where: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<корень>'}: ${i.message}`)
      .join('; ');
    throw new Error(`${where}: ${issues}`);
  }
  return parsed.data;
}

export function parseFederalRules(raw: RawFederalRules): FederalRules {
  const quality = parseFile(QualityRulesFileSchema, raw.quality, 'rules/federal/quality-354.yaml');
  const interruption = parseFile(
    InterruptionRulesFileSchema,
    raw.interruption,
    'rules/federal/interruption-354.yaml',
  );
  const deadlines = parseFile(
    DeadlineRulesFileSchema,
    raw.deadlines,
    'rules/federal/deadlines-416.yaml',
  );

  const versions = new Set([quality.version, interruption.version, deadlines.version]);
  if (versions.size > 1) {
    throw new Error(
      `rules/federal: версии файлов разошлись (${[...versions].join(', ')}) — расчёт перестанет быть воспроизводимым`,
    );
  }

  return {
    version: quality.version,
    quality: quality.items,
    interruption: interruption.items,
    deadlines: deadlines.items,
  };
}

export function parseRegionPackage(raw: RawRegionPackage): RegionPackage {
  const meta = parseFile(RegionMetaSchema, raw.meta, 'meta.yaml');
  const where = (file: string) => `regions/${meta.code}/${file}`;

  const categories = parseFile(
    RegionCategoriesFileSchema,
    raw.categories,
    where('categories.yaml'),
  );
  const tariffs = parseFile(RegionTariffsFileSchema, raw.tariffs, where('tariffs.yaml'));
  const normatives = parseFile(
    RegionNormativesFileSchema,
    raw.normatives,
    where('normatives.yaml'),
  );
  const orgs = parseFile(RegionOrgsFileSchema, raw.orgs, where('orgs.yaml'));
  const houses = parseFile(RegionHousesFileSchema, raw.houses, where('houses.yaml'));

  for (const [file, data] of [
    ['categories.yaml', categories],
    ['tariffs.yaml', tariffs],
    ['normatives.yaml', normatives],
    ['orgs.yaml', orgs],
    ['houses.yaml', houses],
  ] as const) {
    if (data.region !== meta.code) {
      throw new Error(
        `${where(file)}: регион ${data.region} не совпадает с ${meta.code} из meta.yaml`,
      );
    }
  }

  const orgIds = new Set(orgs.items.map((o) => o.id));
  for (const house of houses.items) {
    if (!orgIds.has(house.orgId)) {
      throw new Error(
        `${where('houses.yaml')}: дом ${house.id} ссылается на неизвестную организацию ${house.orgId}`,
      );
    }
  }

  return {
    meta,
    categories: categories.items,
    tariffs: tariffs.items,
    normatives: normatives.items,
    orgs: orgs.items,
    houses: houses.items,
  };
}

/**
 * Категории для интерфейса. Срок не хранится в регионе числом: категория ссылается
 * на норму, а часы берутся оттуда — так у каждого срока есть основание.
 * Заодно проверяются ссылки на правила качества и перерывов.
 */
export function resolveCategories(region: RegionPackage, rules: FederalRules): Category[] {
  const deadlineById = new Map(rules.deadlines.map((d) => [d.id, d]));
  const qualityIds = new Set(rules.quality.map((r) => r.id));
  const interruptionIds = new Set(rules.interruption.map((r) => r.id));

  return region.categories.map((c) => {
    const deadline = deadlineById.get(c.slaRule);
    if (!deadline) {
      throw new Error(`Категория ${c.code}: неизвестный срок ${c.slaRule}`);
    }
    if (c.qualityRule && !qualityIds.has(c.qualityRule)) {
      throw new Error(`Категория ${c.code}: неизвестное правило качества ${c.qualityRule}`);
    }
    if (c.interruptionRule && !interruptionIds.has(c.interruptionRule)) {
      throw new Error(`Категория ${c.code}: неизвестное правило перерыва ${c.interruptionRule}`);
    }
    if (c.kind === 'utility_quality' && !c.qualityRule) {
      throw new Error(`Категория ${c.code}: для проверки качества нужна ссылка на норму`);
    }
    if (c.kind === 'utility_interruption' && !c.interruptionRule) {
      throw new Error(
        `Категория ${c.code}: для перерыва нужна ссылка на допустимую продолжительность`,
      );
    }

    return {
      code: c.code,
      title: c.title,
      kind: c.kind,
      slaHours: deadline.hours,
      ...(c.service ? { service: c.service } : {}),
      ...(c.zone ? { zone: c.zone } : {}),
    };
  });
}

export const findTariff = (region: RegionPackage, service: Tariff['service']): Tariff | undefined =>
  region.tariffs.find((t) => t.service === service);

export const findNormative = (
  region: RegionPackage,
  service: Normative['service'],
): Normative | undefined => region.normatives.find((n) => n.service === service);
