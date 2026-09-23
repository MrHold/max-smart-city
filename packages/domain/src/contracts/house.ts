import * as z from 'zod';
import {
  ContactKindSchema,
  IsoDateTime,
  ProvenanceSchema,
  RequestKindSchema,
  ServiceSchema,
} from './common';

export const HouseSearchItemSchema = z.object({
  id: z.string(),
  address: z.string(),
  regionCode: z.string(),
  dataKind: ProvenanceSchema,
});
export type HouseSearchItem = z.infer<typeof HouseSearchItemSchema>;

/** `days` — дни недели по ISO: 1 — понедельник, 7 — воскресенье. Время местное для дома. */
export const ScheduleSchema = z.object({
  days: z.array(z.int().min(1).max(7)),
  from: z.string().regex(/^\d{2}:\d{2}$/),
  to: z.string().regex(/^\d{2}:\d{2}$/),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const ContactSchema = z.object({
  kind: ContactKindSchema,
  phone: z.string(),
  schedule: ScheduleSchema.nullable(),
  open: z
    .object({
      isOpen: z.boolean(),
      until: z.string().nullable(),
    })
    .nullable(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const HomeSchema = z.object({
  house: z.object({
    id: z.string(),
    address: z.string(),
    tz: z.string(),
    dataKind: ProvenanceSchema,
  }),
  org: z
    .object({
      id: z.string(),
      name: z.string(),
      address: z.string().nullable(),
      dataKind: ProvenanceSchema,
    })
    .nullable(),
  contacts: z.array(ContactSchema),
  announcement: z
    .object({
      title: z.string(),
      text: z.string(),
    })
    .nullable(),
  now: IsoDateTime,
});
export type Home = z.infer<typeof HomeSchema>;

export const CategorySchema = z.object({
  code: z.string(),
  title: z.string(),
  kind: RequestKindSchema,
  service: ServiceSchema.optional(),
  zone: z.enum(['yard', 'entrance', 'apartment']).optional(),
  slaHours: z.number().positive(),
});
export type Category = z.infer<typeof CategorySchema>;
