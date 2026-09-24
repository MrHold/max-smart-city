import * as z from 'zod';
import {
  ContactKindSchema,
  type ProvenanceSchema,
  RequestKindSchema,
  ServiceSchema,
} from '../contracts/common';
import { ScheduleSchema } from '../contracts/house';

/**
 * Схемы данных, лежащих в rules/federal и regions/<код>.
 * Ядро само файлы не читает: снаружи приходит уже разобранный YAML,
 * а эти схемы проверяют, что в нём есть всё нужное.
 */

const SourceSchema = z.object({
  act: z.string().optional(),
  point: z.string().optional(),
  title: z.string().optional(),
  url: z.url().optional(),
  note: z.string().optional(),
});

const DataKindSchema = z.enum(['official', 'model']);

/** Происхождение данных для бейджа в интерфейсе: норма — факт, наши допущения — модель. */
export const toProvenance = (
  kind: z.infer<typeof DataKindSchema>,
): z.infer<typeof ProvenanceSchema> => (kind === 'official' ? 'fact' : 'model');

const ToleranceSchema = z.object({
  night: z.object({
    from: z.string().regex(/^\d{2}:\d{2}$/),
    to: z.string().regex(/^\d{2}:\d{2}$/),
    maxDeviationCelsius: z.number().nonnegative(),
  }),
  day: z.object({
    maxDeviationCelsius: z.number().nonnegative(),
  }),
});

export const QualityRuleSchema = z.object({
  id: z.string(),
  service: ServiceSchema,
  title: z.string(),
  places: z.array(z.enum(['room', 'corner_room', 'tap'])).min(1),
  source: SourceSchema,
  norm: z.object({
    celsius: z.number(),
    cornerRoomCelsius: z.number().optional(),
    coldWaterFallbackBelowCelsius: z.number().optional(),
  }),
  tolerance: ToleranceSchema,
  reduction: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('per_hour_per_degree'), percent: z.number().positive() }),
    z.object({
      kind: z.literal('per_hour_per_step'),
      stepCelsius: z.number().positive(),
      percent: z.number().positive(),
    }),
  ]),
});
export type QualityRule = z.infer<typeof QualityRuleSchema>;

export const QualityRulesFileSchema = z.object({
  version: z.string(),
  dataKind: DataKindSchema,
  source: SourceSchema,
  items: z.array(QualityRuleSchema).min(1),
});

export const InterruptionRuleSchema = z.object({
  id: z.string(),
  service: ServiceSchema,
  title: z.string(),
  source: SourceSchema,
  limits: z.object({
    monthlyHours: z.number().positive(),
    singleHours: z.number().positive().optional(),
    accidentSingleHours: z.number().positive().optional(),
    /** Для отопления допустимый перерыв зависит от температуры в квартире. */
    singleHoursByIndoorTemperature: z
      .array(
        z.object({
          fromCelsius: z.number(),
          toCelsius: z.number().optional(),
          hours: z.number().positive(),
        }),
      )
      .optional(),
  }),
  planned: z
    .object({
      allowedDays: z.number().positive(),
      note: z.string().optional(),
    })
    .optional(),
  reduction: z.object({
    kind: z.literal('per_hour'),
    percent: z.number().positive(),
  }),
});
export type InterruptionRule = z.infer<typeof InterruptionRuleSchema>;

export const InterruptionRulesFileSchema = z.object({
  version: z.string(),
  dataKind: DataKindSchema,
  source: SourceSchema,
  items: z.array(InterruptionRuleSchema).min(1),
});

export const DeadlineRuleSchema = z.object({
  id: z.string(),
  title: z.string(),
  hours: z.number().positive(),
  /**
   * Как течёт срок. Аварийные считаются календарно, круглосуточно.
   * Ремонтные — только в рабочие дни: заявка, поданная в пятницу вечером,
   * не должна просрочиться в субботу.
   */
  clock: z.enum(['calendar', 'working']).default('calendar'),
  dataKind: DataKindSchema,
  source: SourceSchema.optional(),
  note: z.string().optional(),
});
export type DeadlineRule = z.infer<typeof DeadlineRuleSchema>;

export const DeadlineRulesFileSchema = z.object({
  version: z.string(),
  dataKind: DataKindSchema,
  items: z.array(DeadlineRuleSchema).min(1),
});

/** Производственный календарь: даты в формате YYYY-MM-DD по местному времени. */
export const WorkCalendarSchema = z.object({
  year: z.int(),
  dataKind: DataKindSchema,
  note: z.string().optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  workingWeekends: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
});
export type WorkCalendar = z.infer<typeof WorkCalendarSchema>;

export const RegionMetaSchema = z.object({
  code: z.string(),
  name: z.string(),
  timezone: z.string(),
  asOf: z.string(),
  rulesVersion: z.string(),
  dataKind: DataKindSchema,
  note: z.string().optional(),
});
export type RegionMeta = z.infer<typeof RegionMetaSchema>;

export const RegionCategorySchema = z.object({
  code: z.string(),
  title: z.string(),
  kind: RequestKindSchema,
  service: ServiceSchema.optional(),
  zone: z.enum(['yard', 'entrance', 'apartment']).optional(),
  slaRule: z.string(),
  qualityRule: z.string().optional(),
  interruptionRule: z.string().optional(),
});
export type RegionCategory = z.infer<typeof RegionCategorySchema>;

export const TariffSchema = z.object({
  service: ServiceSchema,
  unit: z.enum(['gcal', 'm3']),
  valueKopecks: z.int().positive(),
  validFrom: z.string(),
  validTo: z.string(),
  dataKind: DataKindSchema,
  source: SourceSchema,
});
export type Tariff = z.infer<typeof TariffSchema>;

export const NormativeSchema = z.object({
  service: ServiceSchema,
  unit: z.enum(['gcal_per_m2_month', 'm3_per_person_month']),
  value: z.number().positive(),
  dataKind: DataKindSchema,
  source: SourceSchema,
});
export type Normative = z.infer<typeof NormativeSchema>;

export const RegionOrgSchema = z.object({
  id: z.string(),
  type: z.enum(['uk', 'tsj', 'rso', 'gji', 'contractor']),
  name: z.string(),
  address: z.string().nullable().default(null),
  dataKind: DataKindSchema,
  contacts: z.array(
    z.object({
      kind: ContactKindSchema,
      phone: z.string(),
      schedule: ScheduleSchema.nullable(),
    }),
  ),
  announcement: z
    .object({
      title: z.string(),
      text: z.string(),
    })
    .nullable()
    .default(null),
});
export type RegionOrg = z.infer<typeof RegionOrgSchema>;

export const RegionHouseSchema = z.object({
  id: z.string(),
  address: z.string(),
  fiasId: z.string(),
  orgId: z.string(),
  entrances: z.int().positive().optional(),
  floors: z.int().positive().optional(),
  dataKind: DataKindSchema,
});
export type RegionHouse = z.infer<typeof RegionHouseSchema>;

export const RegionExecutorSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  /** Короткое имя для жителя: «Иванов И.». Фамилия целиком и телефон не раскрываются. */
  nameShort: z.string(),
  categories: z.array(z.string()).min(1),
  dataKind: DataKindSchema,
});
export type RegionExecutor = z.infer<typeof RegionExecutorSchema>;

const listFile = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ region: z.string(), items: z.array(item) });

export const RegionCategoriesFileSchema = listFile(RegionCategorySchema);
export const RegionTariffsFileSchema = listFile(TariffSchema);
export const RegionNormativesFileSchema = listFile(NormativeSchema);
export const RegionOrgsFileSchema = listFile(RegionOrgSchema);
export const RegionHousesFileSchema = listFile(RegionHouseSchema);
export const RegionExecutorsFileSchema = listFile(RegionExecutorSchema);
