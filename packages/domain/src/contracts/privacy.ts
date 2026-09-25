import * as z from 'zod';
import { IsoDateTime } from './common';

/**
 * Что сервис хранит о человеке и как это забрать или удалить.
 *
 * Закон даёт субъекту персональных данных право узнать состав данных, получить их копию
 * и потребовать удаления. Экран «Мои данные» делает это тремя кнопками вместо письма
 * оператору, а заодно показывает, что хранится куда меньше, чем кажется.
 */
export const StoredItemSchema = z.object({
  /** Что это за данные простыми словами. */
  label: z.string(),
  /** Сколько записей такого рода хранится. */
  count: z.int().nonnegative(),
  /** Зачем они нужны — без этого список выглядит как отписка. */
  purpose: z.string(),
  /** Сами значения, если их немного и они принадлежат пользователю. */
  values: z.array(z.string()).optional(),
});
export type StoredItem = z.infer<typeof StoredItemSchema>;

export const MyDataSchema = z.object({
  /** Как пользователь опознаётся в базе: настоящий идентификатор MAX не хранится в открытом виде. */
  userId: z.string(),
  createdAt: IsoDateTime,
  items: z.array(StoredItemSchema),
  /** Что произойдёт при удалении — показывается до нажатия, а не после. */
  deletionNotice: z.string(),
});
export type MyData = z.infer<typeof MyDataSchema>;

export const DeleteMeResultSchema = z.object({
  deleted: z.object({
    memberships: z.int().nonnegative(),
    consents: z.int().nonnegative(),
    joins: z.int().nonnegative(),
    notifications: z.int().nonnegative(),
  }),
  /** Заявки не удаляются, а обезличиваются: они нужны дому и присоединившимся соседям. */
  anonymizedRequests: z.int().nonnegative(),
});
export type DeleteMeResult = z.infer<typeof DeleteMeResultSchema>;
