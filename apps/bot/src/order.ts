import { join } from 'node:path';
import type { Bot } from '@maxhub/max-bot-api';
import {
  and,
  asc,
  type Db,
  type DbOrTx,
  eq,
  houses,
  inArray,
  joins,
  photos,
  requestEvents,
  requests,
  sql,
} from '@msc/db';
import { type OrderStage, orderKeyboard } from './keyboards';
import { categoryTitle, orderCard } from './order-card';

export type RequestRow = typeof requests.$inferSelect;

const ORDER_PHOTOS = 3;
export const ACTIVE_STATUSES: readonly string[] = ['assigned', 'in_progress', 'reopened'];

/** Вложение исходящего сообщения: фото или клавиатура (библиотека этот тип не экспортирует). */
export type Attachment = NonNullable<
  NonNullable<Parameters<Bot['api']['sendMessageToUser']>[2]>['attachments']
>[number];

type Incoming = { type?: string; payload?: unknown };

export const stageOf = (status: string): OrderStage =>
  status === 'in_progress' ? 'in_progress' : 'assigned';

/**
 * Все заявки той же проблемы у того же исполнителя на том же шаге: один дом, одна категория.
 * Наряд и его кнопки действуют на них разом — как массовое действие в кабинете диспетчера.
 */
export async function problemRequests(db: DbOrTx, row: RequestRow): Promise<RequestRow[]> {
  if (!row.executorId) return [row];
  return db
    .select()
    .from(requests)
    .where(
      and(
        eq(requests.executorId, row.executorId),
        eq(requests.houseId, row.houseId),
        eq(requests.category, row.category),
        eq(requests.status, row.status),
      ),
    )
    .orderBy(asc(requests.createdAt));
}

export type OrderView = { text: string; photoKeys: string[]; group: RequestRow[] };

/** Карточка наряда по данным из базы: адрес, масштаб, плановое время и фото жителей. */
export async function orderView(db: Db, row: RequestRow): Promise<OrderView> {
  const group = await problemRequests(db, row);
  const ids = group.map((r) => r.id);

  const [house] = await db
    .select({ address: houses.address })
    .from(houses)
    .where(eq(houses.id, row.houseId))
    .limit(1);
  // Плановое время хранится в событии назначения: при переназначении берём последнее.
  const [assigned] = await db
    .select({ payload: requestEvents.payload })
    .from(requestEvents)
    .where(and(eq(requestEvents.requestId, row.id), eq(requestEvents.type, 'assigned')))
    .orderBy(sql`${requestEvents.at} desc`)
    .limit(1);
  const [joined] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(joins)
    .where(inArray(joins.requestId, ids));
  const before = await db
    .select({ key: photos.storageKey })
    .from(photos)
    .where(and(inArray(photos.requestId, ids), eq(photos.stage, 'before')))
    .orderBy(asc(photos.at))
    .limit(ORDER_PHOTOS);

  const plannedAt = (assigned?.payload as { plannedAt?: unknown } | null | undefined)?.plannedAt;
  const description = group.map((r) => r.description).find((d) => d?.trim());
  return {
    text: orderCard({
      numbers: group.map((r) => r.number),
      address: house?.address,
      apartments: group.length + (joined?.n ?? 0),
      category: row.category,
      description,
      plannedAt,
    }),
    photoKeys: [...new Set(before.map((p) => p.key))],
    group,
  };
}

/** Загружает фото жителей в MAX. Не загрузилось — наряд уйдёт без него, это не повод его терять. */
export async function uploadPhotos(
  bot: Bot,
  photosDir: string | null,
  keys: string[],
): Promise<Attachment[]> {
  if (!photosDir) return [];
  const out: Attachment[] = [];
  for (const key of keys) {
    try {
      const image = await bot.api.uploadImage({ source: join(photosDir, key) });
      out.push(image.toJson());
    } catch (err) {
      console.warn('Фото к наряду не загрузилось:', err instanceof Error ? err.message : err);
    }
  }
  return out;
}

export const orderHint = (stage: OrderStage): string =>
  stage === 'assigned'
    ? 'Нажмите «Принял», когда возьмёте наряд в работу.'
    : 'Когда закончите — нажмите «Выполнено».';

type SendFn = (text: string, extra: { attachments: Attachment[] }) => Promise<unknown>;

/**
 * Наряд с фото жителей и кнопками шага. MAX иногда не успевает обработать только что
 * загруженное фото — тогда повторяем, а в крайнем случае отправляем наряд без фото.
 */
export async function sendOrder(
  send: SendFn,
  bot: Bot,
  photosDir: string | null,
  view: OrderView,
  requestId: string,
  stage: OrderStage,
): Promise<void> {
  const text = `${view.text}\n\n${orderHint(stage)}`;
  const keyboard = orderKeyboard(requestId, stage);
  const images = await uploadPhotos(bot, photosDir, view.photoKeys);
  for (let attempt = 0; images.length > 0 && attempt < 3; attempt++) {
    try {
      await send(text, { attachments: [...images, keyboard] });
      return;
    } catch (err) {
      console.warn('Наряд с фото не отправился:', err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await send(text, { attachments: [keyboard] });
}

/** Фото из уже отправленного сообщения — чтобы не потерять их, когда сообщение меняется. */
export function imagesOf(message: unknown): Attachment[] {
  const attachments = (message as { body?: { attachments?: Incoming[] | null } } | undefined)?.body
    ?.attachments;
  return (attachments ?? []).flatMap((a): Attachment[] => {
    const token = (a.payload as { token?: unknown } | undefined)?.token;
    return a.type === 'image' && typeof token === 'string'
      ? [{ type: 'image', payload: { token } }]
      : [];
  });
}

/** Активные наряды исполнителя, по одному на проблему: самые ранние сверху. */
export async function activeOrders(
  db: Db,
  executorId: string,
): Promise<Array<{ requestId: string; label: string }>> {
  const rows = await db
    .select({
      id: requests.id,
      houseId: requests.houseId,
      category: requests.category,
      status: requests.status,
      address: houses.address,
    })
    .from(requests)
    .innerJoin(houses, eq(requests.houseId, houses.id))
    .where(and(eq(requests.executorId, executorId), inArray(requests.status, [...ACTIVE_STATUSES])))
    .orderBy(asc(requests.createdAt));

  const seen = new Set<string>();
  const items: Array<{ requestId: string; label: string }> = [];
  for (const r of rows) {
    const problem = `${r.houseId}:${r.category}:${r.status}`;
    if (seen.has(problem)) continue;
    seen.add(problem);
    const mark = r.status === 'in_progress' ? '▶️' : '🆕';
    items.push({
      requestId: r.id,
      label: `${mark} ${categoryTitle(r.category) ?? r.category} · ${r.address}`.slice(0, 64),
    });
  }
  return items;
}
