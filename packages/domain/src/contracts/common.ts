import * as z from 'zod';

export const ProvenanceSchema = z.enum(['fact', 'calc', 'model']);
export type Provenance = z.infer<typeof ProvenanceSchema>;

export const RoleSchema = z.enum(['resident', 'dispatcher', 'executor']);
export type Role = z.infer<typeof RoleSchema>;

export const ServiceSchema = z.enum(['heating', 'hot_water', 'cold_water']);
export type Service = z.infer<typeof ServiceSchema>;

export const RequestKindSchema = z.enum([
  'emergency',
  'repair',
  'utility_quality',
  'utility_interruption',
]);
export type RequestKind = z.infer<typeof RequestKindSchema>;

export const RequestStatusSchema = z.enum([
  'new',
  'accepted',
  'rejected',
  'assigned',
  'in_progress',
  'done',
  'confirmed',
  'reopened',
]);
export type RequestStatus = z.infer<typeof RequestStatusSchema>;

export const LocationScopeSchema = z.enum(['yard', 'entrance', 'floor', 'apartment']);
export type LocationScope = z.infer<typeof LocationScopeSchema>;

export const MeasurementPlaceSchema = z.enum(['room', 'corner_room', 'tap']);
export type MeasurementPlace = z.infer<typeof MeasurementPlaceSchema>;

export const ContactKindSchema = z.enum(['office', 'dispatcher', 'emergency']);
export type ContactKind = z.infer<typeof ContactKindSchema>;

/** Время в контрактах всегда UTC: `2026-11-08T14:20:00Z`. Смещения не принимаем — часовой пояс дома лежит в данных региона. */
export const IsoDateTime = z.iso.datetime();

/** Деньги только в целых копейках: рубли с плавающей точкой дают 411,99999 вместо 412. */
export const Kopecks = z.int().nonnegative();

/** «кв. 48», «кв. 12а». Номер от 1 до 9999 — «кв. 9999999» проходить не должна. */
export const ApartmentLabelSchema = z
  .string()
  .trim()
  .regex(/^кв\. ?\d{1,4}[а-яё]?$/i, 'Номер квартиры — от 1 до 4 цифр, например «кв. 48»')
  .refine((s) => Number(s.replace(/\D/g, '')) >= 1, 'Номер квартиры не может быть нулём');

export const NormRefSchema = z.object({
  act: z.string().min(1),
  point: z.string().min(1),
  url: z.url().optional(),
});
export type NormRef = z.infer<typeof NormRefSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
