import {
  calcLiability,
  checkQuality,
  type Liability,
  type Measurement,
  type RegionCategory,
  type RegionPackage,
} from '@msc/domain';
import type { RegionsData } from '../data/regions';

export interface LiabilityArgs {
  requestId: string;
  category: RegionCategory;
  region: RegionPackage;
  rules: RegionsData['rules'];
  tz: string;
  startedAt: Date;
  endedAt: Date | null;
  plannedNotice: boolean | null;
  accident: boolean;
  measurements: Measurement[];
  affectedApartments: number;
  billing: {
    monthlyChargeKopecks: number | null;
    apartmentAreaM2: number | null;
    residents: number | null;
  };
}

/**
 * Считает сумму снижения платы по заявке. Используется и карточкой, и документами,
 * и кабинетом диспетчера — цифра везде должна быть одна и та же.
 *
 * Возвращает null там, где денег не бывает в принципе: ремонтные категории без норматива
 * качества, а также случаи, когда правило требует данных, которых у нас нет. Ошибку наружу
 * не пускаем: карточка заявки должна открыться в любом случае, просто без суммы.
 */
export function liabilityFor(args: LiabilityArgs, now: Date): Liability | null {
  const { category, rules } = args;
  const service = category.service;
  if (!service) return null;

  const input = {
    requestId: args.requestId,
    service,
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    plannedNotice: args.plannedNotice,
    accident: args.accident,
    affectedApartments: args.affectedApartments,
    billing: args.billing,
  };

  try {
    if (category.qualityRule) {
      const rule = rules.quality.find((r) => r.id === category.qualityRule);
      if (!rule) return null;
      const verdict = checkQuality(args.measurements, rule, {
        tz: args.tz,
        until: args.endedAt ?? now,
      });
      return calcLiability(input, { quality: { rule, verdict } }, args.region, now);
    }

    if (category.interruptionRule) {
      const rule = rules.interruption.find((r) => r.id === category.interruptionRule);
      if (!rule) return null;
      return calcLiability(
        input,
        { interruption: { rule, measurements: args.measurements } },
        args.region,
        now,
      );
    }
  } catch {
    return null;
  }

  return null;
}
