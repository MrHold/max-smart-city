import * as z from 'zod';
import { IsoDateTime, Kopecks, RequestKindSchema, RequestStatusSchema } from './common';

/**
 * Кабинет диспетчера. Входящие сгруппированы по причинам: одна авария в доме — одна строка,
 * а не сорок одинаковых заявок. Рядом с каждой строкой — срок по норме и цена простоя,
 * которая растёт, пока проблема не устранена.
 */
export const ClusterCardSchema = z.object({
  key: z.string(),
  houseId: z.string(),
  houseAddress: z.string(),
  category: z.string(),
  title: z.string(),
  kind: RequestKindSchema,
  /** Наименее продвинутый статус в кластере: по нему понятно, что делать дальше. */
  status: RequestStatusSchema,
  requestIds: z.array(z.string()).min(1),
  /** Затронуто квартир: заявители плюс присоединившиеся соседи. */
  apartments: z.int().positive(),
  startedAt: IsoDateTime,
  /** Самый ранний срок в кластере. */
  dueAt: IsoDateTime,
  overdue: z.boolean(),
  /** Во сколько обойдётся простой, если ничего не делать, — оценка по дому. */
  kopecks: Kopecks,
  perHourKopecks: Kopecks,
  executor: z
    .object({
      id: z.string(),
      nameShort: z.string(),
      plannedAt: IsoDateTime.nullable(),
    })
    .nullable(),
});
export type ClusterCard = z.infer<typeof ClusterCardSchema>;

export const DispatcherInboxSchema = z.object({
  orgName: z.string(),
  now: IsoDateTime,
  clusters: z.array(ClusterCardSchema),
  /** Итог по всем открытым кластерам — цифра, ради которой чинят быстрее. */
  totalKopecks: Kopecks,
  totalPerHourKopecks: Kopecks,
});
export type DispatcherInbox = z.infer<typeof DispatcherInboxSchema>;

export const ExecutorSchema = z.object({
  id: z.string(),
  nameShort: z.string(),
  categories: z.array(z.string()),
  /** Исполнитель открыл приглашение и получает наряды в боте. false — назначить можно, но наряд не придёт. */
  inBot: z.boolean(),
});
export type Executor = z.infer<typeof ExecutorSchema>;

/** Ссылка-приглашение в бот: исполнитель открывает её в MAX и начинает получать наряды. */
export const ExecutorInviteSchema = z.object({ url: z.string().url() });
export type ExecutorInvite = z.infer<typeof ExecutorInviteSchema>;

/** Действие применяется сразу ко всем заявкам кластера: в этом и смысл группировки. */
const RequestIds = z.array(z.string()).min(1).max(200);

export const AcceptInputSchema = z.object({ requestIds: RequestIds });
export type AcceptInput = z.infer<typeof AcceptInputSchema>;

export const RejectInputSchema = z.object({
  requestIds: RequestIds,
  reason: z.string().min(1).max(500),
});
export type RejectInput = z.infer<typeof RejectInputSchema>;

export const AssignInputSchema = z.object({
  requestIds: RequestIds,
  executorId: z.string(),
  /** Когда исполнитель обещает прийти. Жителю это важнее телефона. */
  plannedAt: IsoDateTime.optional(),
});
export type AssignInput = z.infer<typeof AssignInputSchema>;

export const CompleteInputSchema = z.object({
  requestIds: RequestIds,
  photoKeys: z.array(z.string()).max(5).default([]),
});
export type CompleteInput = z.infer<typeof CompleteInputSchema>;

/** Сколько заявок обработано и какие статусы получились — ответ на массовое действие. */
export const BulkResultSchema = z.object({
  updated: z.int().nonnegative(),
  skipped: z.array(z.object({ requestId: z.string(), reason: z.string() })),
});
export type BulkResult = z.infer<typeof BulkResultSchema>;
