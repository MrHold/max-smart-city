import * as z from 'zod';
import { RoleSchema } from './common';

/** Ответ GET /api/me: кто открыл мини-приложение. Первый вызов создаёт пользователя. */
export const MeSchema = z.object({
  user: z.object({
    /** users.id в нашей БД, не идентификатор MAX */
    id: z.string(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    username: z.string().nullable(),
    photoUrl: z.string().nullable(),
  }),
  /** Главная роль: сотрудник УК важнее жителя; null — привязок ещё нет */
  role: RoleSchema.nullable(),
  house: z
    .object({
      id: z.string(),
      address: z.string(),
    })
    .nullable(),
  apartmentLabel: z.string().nullable(),
  consentGiven: z.boolean(),
  memberships: z.array(
    z.object({
      role: RoleSchema,
      houseId: z.string().nullable(),
      orgId: z.string().nullable(),
      apartmentLabel: z.string().nullable(),
      confirmed: z.boolean(),
    }),
  ),
  /** startapp=… из диплинка, если мини-приложение открыли по ссылке */
  startParam: z.string().nullable(),
});
export type Me = z.infer<typeof MeSchema>;

export const BindHouseInputSchema = z.object({
  houseId: z.string(),
  apartmentLabel: z.string().min(1).max(20),
});
export type BindHouseInput = z.infer<typeof BindHouseInputSchema>;
