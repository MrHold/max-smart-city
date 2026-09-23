import * as z from 'zod';
import { RoleSchema } from './common';

export const MeSchema = z.object({
  userId: z.string(),
  role: RoleSchema,
  house: z
    .object({
      id: z.string(),
      address: z.string(),
      apartmentLabel: z.string().nullable(),
    })
    .nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export const BindHouseInputSchema = z.object({
  houseId: z.string(),
  apartmentLabel: z.string().min(1).max(20),
});
export type BindHouseInput = z.infer<typeof BindHouseInputSchema>;
