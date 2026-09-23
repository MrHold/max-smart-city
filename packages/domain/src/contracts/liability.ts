import * as z from 'zod';
import { IsoDateTime, Kopecks, NormRefSchema, ProvenanceSchema } from './common';

/** Один шаг расчёта. Из `steps` собирается разбивка суммы в интерфейсе, `provenance` превращается в бейдж. */
export const LiabilityStepSchema = z.object({
  label: z.string(),
  value: z.number(),
  unit: z.string(),
  provenance: ProvenanceSchema,
  ref: NormRefSchema.optional(),
});
export type LiabilityStep = z.infer<typeof LiabilityStepSchema>;

export const LiabilitySchema = z.object({
  requestId: z.string(),
  /** Снижение платы заявителю: его площадь и его тариф. */
  apartmentKopecks: Kopecks,
  /** Оценка по дому: площади присоединившихся соседей неизвестны, поэтому provenance у шага — 'model'. */
  houseKopecks: Kopecks,
  /** Сколько добавляется за час простоя — цифра для диспетчера. */
  perHourHouseKopecks: Kopecks,
  /** Часы СВЕРХ допустимого порога, а не с первой минуты нарушения. */
  hours: z.number().nonnegative(),
  /** Момент, с которого пошёл счётчик. null — порог ещё не пройден, снижения платы нет. */
  thresholdReachedAt: IsoDateTime.nullable(),
  steps: z.array(LiabilityStepSchema),
  computedAt: IsoDateTime,
  /** Версия rules/ и regions/, на которых посчитано: расчёт должен воспроизводиться. */
  rulesVersion: z.string(),
});
export type Liability = z.infer<typeof LiabilitySchema>;
