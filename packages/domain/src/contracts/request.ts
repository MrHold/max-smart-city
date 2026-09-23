import * as z from 'zod';
import {
  IsoDateTime,
  LocationScopeSchema,
  MeasurementPlaceSchema,
  RequestKindSchema,
  RequestStatusSchema,
  ServiceSchema,
} from './common';
import { LiabilitySchema } from './liability';

export const MeasurementSchema = z.object({
  value: z.number(),
  unit: z.literal('celsius'),
  measuredAt: IsoDateTime,
  /** Норма отопления в угловой комнате выше, чем в обычной, поэтому место замера обязательно. */
  place: MeasurementPlaceSchema,
});
export type Measurement = z.infer<typeof MeasurementSchema>;

export const LocationSchema = z.object({
  scope: LocationScopeSchema,
  entrance: z.int().positive().optional(),
  floor: z.int().optional(),
  note: z.string().max(200).optional(),
});
export type Location = z.infer<typeof LocationSchema>;

export const NewRequestInputSchema = z.object({
  category: z.string().min(1),
  location: LocationSchema,
  description: z.string().max(1000),
  startedAt: IsoDateTime,
  measurements: z.array(MeasurementSchema),
  /** Было ли объявление о плановом отключении. Только для перерывов; null — неизвестно. */
  plannedNotice: z.boolean().nullable(),
  photoKeys: z.array(z.string()).max(5),
});
export type NewRequestInput = z.infer<typeof NewRequestInputSchema>;

export const RequestSummarySchema = z.object({
  id: z.string(),
  /** Человекочитаемый номер вида 2026-0114 — его называют в разговоре с УК. */
  number: z.string(),
  title: z.string(),
  kind: RequestKindSchema,
  status: RequestStatusSchema,
  createdAt: IsoDateTime,
  dueAt: IsoDateTime,
  overdue: z.boolean(),
  locationText: z.string(),
  joinersCount: z.int().nonnegative(),
});
export type RequestSummary = z.infer<typeof RequestSummarySchema>;

export const RequestEventSchema = z.object({
  type: z.string(),
  label: z.string(),
  at: IsoDateTime,
});
export type RequestEvent = z.infer<typeof RequestEventSchema>;

/** Что о присоединившемся соседе видят остальные: номер квартиры и время. Без имени. */
export const JoinerPublicSchema = z.object({
  apartmentLabel: z.string(),
  joinedAt: IsoDateTime,
});
export type JoinerPublic = z.infer<typeof JoinerPublicSchema>;

/** Полная запись присоединения — только на сервере, в расчёт уходят замеры. */
export const JoinerSchema = JoinerPublicSchema.extend({
  requestId: z.string(),
  measurements: z.array(MeasurementSchema),
});
export type Joiner = z.infer<typeof JoinerSchema>;

export const JoinInputSchema = z.object({
  apartmentLabel: z.string().min(1).max(20),
  measurements: z.array(MeasurementSchema),
});
export type JoinInput = z.infer<typeof JoinInputSchema>;

export const ConfirmInputSchema = z.object({
  accepted: z.boolean(),
  note: z.string().max(1000).optional(),
});
export type ConfirmInput = z.infer<typeof ConfirmInputSchema>;

export const RequestDetailSchema = RequestSummarySchema.extend({
  service: ServiceSchema.nullable(),
  description: z.string(),
  location: LocationSchema,
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  plannedNotice: z.boolean().nullable(),
  measurements: z.array(MeasurementSchema),
  photos: z.array(z.object({ key: z.string(), url: z.string() })),
  events: z.array(RequestEventSchema),
  joiners: z.array(JoinerPublicSchema),
  liability: LiabilitySchema.nullable(),
  executor: z
    .object({
      nameShort: z.string(),
      slot: z.string().nullable(),
      phone: z.string().nullable(),
    })
    .nullable(),
  isAuthor: z.boolean(),
  canJoin: z.boolean(),
  shareUrl: z.string(),
  claim: z.object({
    available: z.boolean(),
    url: z.string().nullable(),
  }),
  /** Шаг открывается только после истечения срока ответа УК. */
  gji: z.object({
    available: z.boolean(),
    afterAt: IsoDateTime.nullable(),
  }),
});
export type RequestDetail = z.infer<typeof RequestDetailSchema>;
