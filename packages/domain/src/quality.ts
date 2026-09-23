import type { Measurement, NormRef } from './contracts';
import type { QualityRule } from './regions/schema';
import { HOUR_MS, localMinutes, nextLocalTime, toMinutes } from './time';

/** Отрезок между двумя замерами, целиком попавший в день или в ночь. */
export interface QualitySegment {
  from: string;
  to: string;
  hours: number;
  night: boolean;
  /** Что показал замер. */
  value: number;
  /** Ниже какого значения услуга считается некачественной с учётом допуска. */
  allowed: number;
  /** На сколько градусов ниже допустимого. Ноль — нарушения на отрезке нет. */
  deviation: number;
}

export interface QualityVerdict {
  ruleId: string;
  violated: boolean;
  normCelsius: number;
  /** Худший замер за период — его показываем в карточке. */
  worst: { value: number; allowed: number; deviation: number } | null;
  segments: QualitySegment[];
  /** Часы, на которых зафиксировано отклонение. */
  violatingHours: number;
  /** Сумма «часы × градусы отклонения» — основа расчёта для отопления. */
  degreeHours: number;
  /** Сумма «часы × шаги отклонения» — основа расчёта для горячей воды. */
  stepHours: number;
  /** Горячая вода опустилась ниже порога, с которого её оплачивают как холодную. */
  coldWaterFallback: boolean;
  ref: NormRef;
  explanation: string;
}

export interface QualityContext {
  tz: string;
  /** Конец периода: момент устранения или «сейчас», если нарушение продолжается. */
  until: Date;
}

const isNight = (at: Date, tz: string, from: string, to: string): boolean => {
  const minutes = localMinutes(at, tz);
  const start = toMinutes(from);
  const end = toMinutes(to);
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Разбивает период на отрезки: между соседними замерами и по границам ночного послабления.
 * Значение замера действует до следующего замера — иначе часы отклонения посчитать не из чего.
 */
function buildSegments(
  measurements: Measurement[],
  rule: QualityRule,
  ctx: QualityContext,
): QualitySegment[] {
  const sorted = [...measurements].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt));
  const segments: QualitySegment[] = [];

  for (const [index, measurement] of sorted.entries()) {
    const start = new Date(measurement.measuredAt);
    const next = sorted[index + 1];
    const end = next ? new Date(next.measuredAt) : ctx.until;
    if (end.getTime() <= start.getTime()) continue;

    const normCelsius =
      measurement.place === 'corner_room' && rule.norm.cornerRoomCelsius !== undefined
        ? rule.norm.cornerRoomCelsius
        : rule.norm.celsius;

    let cursor = start;
    // Ограничение отсекает бесконечный цикл, если период окажется неправдоподобно длинным.
    for (let guard = 0; guard < 2000 && cursor.getTime() < end.getTime(); guard += 1) {
      const night = isNight(cursor, ctx.tz, rule.tolerance.night.from, rule.tolerance.night.to);
      const boundary = nextLocalTime(
        cursor,
        ctx.tz,
        night ? rule.tolerance.night.to : rule.tolerance.night.from,
      );
      const segmentEnd = new Date(Math.min(boundary.getTime(), end.getTime()));

      const tolerance = night
        ? rule.tolerance.night.maxDeviationCelsius
        : rule.tolerance.day.maxDeviationCelsius;
      const allowed = normCelsius - tolerance;

      segments.push({
        from: cursor.toISOString(),
        to: segmentEnd.toISOString(),
        hours: round2((segmentEnd.getTime() - cursor.getTime()) / HOUR_MS),
        night,
        value: measurement.value,
        allowed,
        deviation: round2(Math.max(0, allowed - measurement.value)),
      });

      cursor = segmentEnd;
    }
  }

  return segments;
}

function explain(rule: QualityRule, verdict: Omit<QualityVerdict, 'explanation'>): string {
  if (!verdict.violated) {
    return `Норма ${verdict.normCelsius} °C соблюдена с учётом допустимого отклонения.`;
  }
  const worst = verdict.worst;
  const night = verdict.segments.some((s) => s.night && s.deviation > 0);
  const base = `Норма ${verdict.normCelsius} °C, у вас ${worst?.value} °C`;
  const tail = night
    ? ' — с учётом ночного послабления это всё равно ниже допустимого'
    : ` — это ниже допустимого на ${worst?.deviation} °C`;
  return `${base}${tail}. ${rule.title}.`;
}

/**
 * Нарушена ли норма качества и на сколько часов.
 *
 * Отклонение считается от допустимого значения, а не от нормы: ночью норма отопления
 * снижается на три градуса, и эти градусы нарушением не являются. Такой счёт даёт
 * меньшую сумму, чем счёт от нормы, — при неоднозначности выбираем трактовку не в свою пользу.
 */
export function checkQuality(
  measurements: Measurement[],
  rule: QualityRule,
  ctx: QualityContext,
): QualityVerdict {
  const segments = buildSegments(measurements, rule, ctx);
  const violating = segments.filter((s) => s.deviation > 0);

  const worstSegment = violating.reduce<QualitySegment | null>(
    (worst, s) => (worst === null || s.deviation > worst.deviation ? s : worst),
    null,
  );

  const step = rule.reduction.kind === 'per_hour_per_step' ? rule.reduction.stepCelsius : 0;

  const verdict: Omit<QualityVerdict, 'explanation'> = {
    ruleId: rule.id,
    violated: violating.length > 0,
    normCelsius: rule.norm.celsius,
    worst: worstSegment
      ? {
          value: worstSegment.value,
          allowed: worstSegment.allowed,
          deviation: worstSegment.deviation,
        }
      : null,
    segments,
    violatingHours: round2(violating.reduce((sum, s) => sum + s.hours, 0)),
    degreeHours: round2(violating.reduce((sum, s) => sum + s.hours * s.deviation, 0)),
    stepHours: step
      ? round2(violating.reduce((sum, s) => sum + s.hours * Math.floor(s.deviation / step), 0))
      : 0,
    coldWaterFallback:
      rule.norm.coldWaterFallbackBelowCelsius !== undefined &&
      measurements.some((m) => m.value < (rule.norm.coldWaterFallbackBelowCelsius ?? 0)),
    ref: {
      act: rule.source.act ?? '',
      point: rule.source.point ?? '',
      ...(rule.source.url ? { url: rule.source.url } : {}),
    },
  };

  return { ...verdict, explanation: explain(rule, verdict) };
}
