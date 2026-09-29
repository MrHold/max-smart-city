import type { Liability, LiabilityStep, Measurement, NormRef, Service } from './contracts';
import type { QualityVerdict } from './quality';
import type { InterruptionRule, QualityRule, RegionPackage } from './regions';
import { findNormative, findTariff } from './regions';
import { HOUR_MS, localMonthStart } from './time';

/**
 * Допущения на время MVP: площадь квартиры и число жильцов у нас не спрашивают,
 * а без них месячную плату из тарифа не посчитать. Значения помечаются как модельные,
 * в интерфейсе у соответствующего шага стоит бейдж «модель».
 */
export const DEFAULT_ASSUMPTIONS = { apartmentAreaM2: 50, residents: 2 } as const;

export interface BillingInput {
  /** Начисление за услугу из квитанции. Если есть — считаем от него, это факт. */
  monthlyChargeKopecks?: number | null;
  apartmentAreaM2?: number | null;
  residents?: number | null;
}

export interface LiabilityInput {
  requestId: string;
  service: Service;
  startedAt: Date;
  /** Момент устранения. null — нарушение продолжается. */
  endedAt: Date | null;
  billing: BillingInput;
  /** Сколько квартир затронуто: заявитель плюс присоединившиеся соседи. */
  affectedApartments: number;
  /** Часы перерыва по этой же услуге в этом доме за расчётный период до текущей заявки. */
  priorHoursThisMonth?: number;
  /** Авария на тупиковой магистрали — для неё допустимый перерыв больше. */
  accident?: boolean;
  /** Было ли объявление о плановом отключении. */
  plannedNotice?: boolean | null;
}

const round = (n: number): number => Math.round(n);
const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Ссылка на норму. Возвращает undefined, если у источника нет акта или пункта:
 * ссылка с пустым пунктом ничего не доказывает и не проходит проверку контракта.
 */
const refOf = (source: { act?: string; point?: string; url?: string }): NormRef | undefined =>
  source.act && source.point
    ? { act: source.act, point: source.point, ...(source.url ? { url: source.url } : {}) }
    : undefined;

const withRef = (ref: NormRef | undefined) => (ref ? { ref } : {});

interface Base {
  kopecks: number;
  steps: LiabilityStep[];
}

/**
 * Месячная плата за услугу — база, от которой считается снижение.
 * Начисление из квитанции точнее, но его может не быть: тогда плата собирается
 * из тарифа и норматива региона, и это честно помечается расчётом на модельных данных.
 */
function resolveBase(input: LiabilityInput, region: RegionPackage): Base {
  const charge = input.billing.monthlyChargeKopecks;
  if (charge && charge > 0) {
    return {
      kopecks: charge,
      steps: [
        {
          label: 'Начисление за услугу за месяц',
          value: charge / 100,
          unit: '₽',
          provenance: 'fact',
        },
      ],
    };
  }

  const tariff = findTariff(region, input.service);
  const normative = findNormative(region, input.service);
  if (!tariff || !normative) {
    throw new Error(
      `В пакете региона ${region.meta.code} нет тарифа или норматива для ${input.service}`,
    );
  }

  const area = input.billing.apartmentAreaM2 ?? DEFAULT_ASSUMPTIONS.apartmentAreaM2;
  const residents = input.billing.residents ?? DEFAULT_ASSUMPTIONS.residents;
  const quantity = normative.unit === 'gcal_per_m2_month' ? area : residents;
  const quantityLabel =
    normative.unit === 'gcal_per_m2_month'
      ? `Площадь квартиры, ${area} м²`
      : `Жильцов, ${residents}`;

  const kopecks = round(tariff.valueKopecks * normative.value * quantity);
  const assumed = input.billing.apartmentAreaM2 == null && input.billing.residents == null;

  return {
    kopecks,
    steps: [
      {
        // Источник тарифа — решение тарифного органа, а не пункт нормы,
        // поэтому ссылка на норму здесь не ставится: она была бы пустой.
        label: tariff.source.title ? `Тариф — ${tariff.source.title}` : 'Тариф',
        value: tariff.valueKopecks / 100,
        unit: tariff.unit === 'gcal' ? '₽/Гкал' : '₽/м³',
        provenance: tariff.dataKind === 'official' ? 'fact' : 'model',
      },
      {
        label: 'Норматив потребления',
        value: normative.value,
        unit: normative.unit === 'gcal_per_m2_month' ? 'Гкал/м² в месяц' : 'м³/чел. в месяц',
        provenance: normative.dataKind === 'official' ? 'fact' : 'model',
      },
      {
        label: quantityLabel,
        value: quantity,
        unit: normative.unit === 'gcal_per_m2_month' ? 'м²' : 'чел.',
        provenance: assumed ? 'model' : 'fact',
      },
      {
        label: 'Плата за услугу за месяц',
        value: kopecks / 100,
        unit: '₽',
        provenance: 'calc',
      },
    ],
  };
}

interface Reduction {
  /** Единицы, за которые снижается плата: градусо-часы, шаго-часы или часы. */
  units: number;
  percentPerUnit: number;
  /** Сколько единиц набегает за час, пока нарушение длится. */
  unitsPerHour: number;
  hours: number;
  thresholdReachedAt: Date | null;
  steps: LiabilityStep[];
  ref: NormRef | undefined;
}

function qualityReduction(verdict: QualityVerdict, rule: QualityRule): Reduction {
  const perStep = rule.reduction.kind === 'per_hour_per_step';
  const units = perStep ? verdict.stepHours : verdict.degreeHours;
  const last = verdict.segments.at(-1);
  const deviation = last?.deviation ?? 0;
  const unitsPerHour = perStep
    ? Math.floor(
        deviation / (rule.reduction.kind === 'per_hour_per_step' ? rule.reduction.stepCelsius : 1),
      )
    : deviation;

  return {
    units,
    percentPerUnit: rule.reduction.percent,
    unitsPerHour,
    hours: verdict.violatingHours,
    thresholdReachedAt: verdict.violated ? new Date(verdict.segments[0]?.from ?? 0) : null,
    ref: refOf(verdict.ref),
    steps: [
      {
        label: perStep ? 'Отклонение, шагов по 3 °C' : 'Отклонение от допустимого',
        value: perStep ? unitsPerHour : deviation,
        unit: perStep ? 'шагов' : '°C',
        provenance: 'fact',
        ...withRef(refOf(verdict.ref)),
      },
      {
        label: 'Часы с отклонением',
        value: verdict.violatingHours,
        unit: 'ч',
        provenance: 'calc',
      },
    ],
  };
}

/** Допустимый единовременный перерыв: для отопления он зависит от температуры в квартире. */
function allowedSingleHours(
  rule: InterruptionRule,
  input: LiabilityInput,
  measurements: Measurement[],
): number {
  if (input.accident && rule.limits.accidentSingleHours) return rule.limits.accidentSingleHours;

  const tiers = rule.limits.singleHoursByIndoorTemperature;
  if (tiers?.length) {
    const indoor = measurements.reduce<number | null>(
      (min, m) => (min === null || m.value < min ? m.value : min),
      null,
    );
    if (indoor === null) {
      throw new Error(
        `Перерыв ${rule.id}: допустимая продолжительность зависит от температуры в квартире, нужен замер`,
      );
    }
    const tier = tiers.find(
      (t) => indoor >= t.fromCelsius && (t.toCelsius === undefined || indoor < t.toCelsius),
    );
    // Ниже самого холодного порога перерыв не допускается вовсе.
    return tier?.hours ?? 0;
  }

  return rule.limits.singleHours ?? rule.limits.monthlyHours;
}

/**
 * Сколько часов перерывов этой же услуги в доме уже было в текущем месяце до начала заявки.
 * Месячный лимит общий на все перерывы, а не на каждую заявку. Перерывы разных жителей
 * одного дома перекрываются — считаем объединение интервалов, чтобы не посчитать час дважды.
 */
export function priorInterruptionHours(
  current: { startedAt: Date },
  others: Array<{ startedAt: Date; endedAt: Date | null }>,
  tz: string,
): number {
  const from = localMonthStart(current.startedAt, tz).getTime();
  const until = current.startedAt.getTime();
  const spans = others
    .map((o) => [
      Math.max(o.startedAt.getTime(), from),
      Math.min(o.endedAt?.getTime() ?? until, until),
    ])
    .filter(([a = 0, b = 0]) => b > a)
    .sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0));

  let total = 0;
  let openFrom = Number.NEGATIVE_INFINITY;
  let openTo = Number.NEGATIVE_INFINITY;
  for (const [a = 0, b = 0] of spans) {
    if (a > openTo) {
      if (openTo > openFrom) total += openTo - openFrom;
      openFrom = a;
      openTo = b;
    } else {
      openTo = Math.max(openTo, b);
    }
  }
  if (openTo > openFrom) total += openTo - openFrom;
  return round2(total / HOUR_MS);
}

function interruptionReduction(
  rule: InterruptionRule,
  input: LiabilityInput,
  measurements: Measurement[],
  now: Date,
): Reduction {
  const until = input.endedAt ?? now;
  const totalHours = round2(Math.max(0, (until.getTime() - input.startedAt.getTime()) / HOUR_MS));

  // Объявленное плановое отключение — не нарушение, но только в пределах своего срока:
  // сверх него плата снижается так же, как за обычный перерыв.
  const plannedDays = input.plannedNotice ? rule.planned?.allowedDays : undefined;
  const prior = input.priorHoursThisMonth ?? 0;
  let allowance: number;
  if (plannedDays !== undefined) {
    allowance = plannedDays * 24;
  } else {
    const single = allowedSingleHours(rule, input, measurements);
    const monthlyLeft = Math.max(0, rule.limits.monthlyHours - prior);
    // Авария на тупиковой магистрали — отдельное исключение с более длинным перерывом.
    // Месячный лимит короче него, и если ограничивать им, исключение никогда не сработает.
    const accidentException = Boolean(input.accident && rule.limits.accidentSingleHours);
    allowance = accidentException ? single : Math.min(single, monthlyLeft);
  }
  const over = round2(Math.max(0, totalHours - allowance));

  return {
    units: over,
    percentPerUnit: rule.reduction.percent,
    unitsPerHour: 1,
    hours: over,
    thresholdReachedAt: over > 0 ? new Date(input.startedAt.getTime() + allowance * HOUR_MS) : null,
    ref: refOf(rule.source),
    steps: [
      {
        label: 'Перерыв длится',
        value: totalHours,
        unit: 'ч',
        provenance: 'fact',
      },
      ...(plannedDays === undefined && prior > 0
        ? [
            {
              label: 'Перерывов в этом месяце до заявки',
              value: prior,
              unit: 'ч',
              provenance: 'fact' as const,
            },
          ]
        : []),
      {
        label:
          plannedDays !== undefined
            ? `Допустимое плановое отключение, ${plannedDays} дней`
            : 'Допустимый перерыв',
        value: allowance,
        unit: 'ч',
        provenance: 'fact',
        ...withRef(refOf(rule.source)),
      },
      {
        label: 'Часы сверх допустимого',
        value: over,
        unit: 'ч',
        provenance: 'calc',
      },
    ],
  };
}

export interface LiabilityRule {
  quality?: { rule: QualityRule; verdict: QualityVerdict };
  interruption?: { rule: InterruptionRule; measurements: Measurement[] };
}

/**
 * Сколько денег стоит нарушение: заявителю — снижение его платы, дому — оценка по всем
 * присоединившимся квартирам.
 *
 * Снижение считается только за часы сверх допустимого, а не с первой минуты нарушения,
 * и не может превысить месячную плату за услугу. Сумма по дому — оценка: площади соседей
 * неизвестны, поэтому их плата принимается равной плате заявителя, и шаг помечен моделью.
 */
export function calcLiability(
  input: LiabilityInput,
  rules: LiabilityRule,
  region: RegionPackage,
  now: Date,
): Liability {
  const empty = (steps: LiabilityStep[]): Liability => ({
    requestId: input.requestId,
    apartmentKopecks: 0,
    houseKopecks: 0,
    perHourHouseKopecks: 0,
    hours: 0,
    thresholdReachedAt: null,
    steps,
    computedAt: now.toISOString(),
    rulesVersion: region.meta.rulesVersion,
  });

  const reduction = rules.quality
    ? qualityReduction(rules.quality.verdict, rules.quality.rule)
    : rules.interruption
      ? interruptionReduction(rules.interruption.rule, input, rules.interruption.measurements, now)
      : null;

  if (!reduction || reduction.units <= 0) {
    return empty(reduction?.steps ?? []);
  }

  const base = resolveBase(input, region);
  const rawApartment = (base.kopecks * reduction.percentPerUnit * reduction.units) / 100;
  const apartmentKopecks = Math.min(base.kopecks, round(rawApartment));
  const capped = round(rawApartment) > base.kopecks;

  const perHourApartment = round(
    (base.kopecks * reduction.percentPerUnit * reduction.unitsPerHour) / 100,
  );
  const affected = Math.max(1, input.affectedApartments);

  const steps: LiabilityStep[] = [
    ...base.steps,
    ...reduction.steps,
    {
      label: 'Снижение платы за единицу',
      value: reduction.percentPerUnit,
      unit: '% в час',
      provenance: 'fact',
      ...withRef(reduction.ref),
    },
    {
      label: 'Снижение платы вам',
      value: apartmentKopecks / 100,
      unit: '₽',
      provenance: 'calc',
      ...withRef(reduction.ref),
    },
    {
      label: 'Затронуто квартир',
      value: affected,
      unit: 'кв.',
      provenance: affected > 1 ? 'fact' : 'calc',
    },
    {
      label: 'Оценка по дому',
      value: (apartmentKopecks * affected) / 100,
      unit: '₽',
      provenance: 'model',
    },
  ];

  if (capped) {
    steps.push({
      label: 'Снижение ограничено месячной платой за услугу',
      value: base.kopecks / 100,
      unit: '₽',
      provenance: 'calc',
    });
  }

  return {
    requestId: input.requestId,
    apartmentKopecks,
    houseKopecks: apartmentKopecks * affected,
    perHourHouseKopecks: perHourApartment * affected,
    hours: reduction.hours,
    thresholdReachedAt: reduction.thresholdReachedAt?.toISOString() ?? null,
    steps,
    computedAt: now.toISOString(),
    rulesVersion: region.meta.rulesVersion,
  };
}
