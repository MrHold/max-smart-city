import { and, type DbOrTx, eq, gt, isNull, lt, ne, or, requests } from '@msc/db';
import {
  calcLiability,
  checkQuality,
  type Liability,
  type Measurement,
  priorInterruptionHours,
  type RegionCategory,
  type RegionPackage,
} from '@msc/domain';
import type { RegionsData } from '../data/regions';

const MONTH_MS = 32 * 24 * 3_600_000;

/**
 * Часы перерывов той же категории в этом доме за текущий месяц до начала заявки:
 * месячный лимит перерывов общий, а не на каждую заявку.
 */
export async function priorHoursFor(
  db: DbOrTx,
  row: { id: string; houseId: string; category: string; startedAt: Date },
  category: RegionCategory,
  tz: string,
): Promise<number> {
  if (!category.interruptionRule) return 0;
  const others = await db
    .select({ startedAt: requests.startedAt, endedAt: requests.endedAt })
    .from(requests)
    .where(
      and(
        eq(requests.houseId, row.houseId),
        eq(requests.category, row.category),
        ne(requests.id, row.id),
        ne(requests.status, 'rejected'),
        lt(requests.startedAt, row.startedAt),
        or(
          isNull(requests.endedAt),
          gt(requests.endedAt, new Date(row.startedAt.getTime() - MONTH_MS)),
        ),
      ),
    );
  return priorInterruptionHours(row, others, tz);
}

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
  /** Часы перерывов в доме за месяц до этой заявки — priorHoursFor(). */
  priorHoursThisMonth?: number;
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
    priorHoursThisMonth: args.priorHoursThisMonth ?? 0,
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
