import { randomUUID } from 'node:crypto';
import {
  and,
  consents,
  type Db,
  eq,
  houses,
  joins,
  memberships,
  outbox,
  photos,
  requests,
  users,
} from '@msc/db';
import type { Clock, DeleteMeResult, MyData, StoredItem } from '@msc/domain';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { getAuth } from '../auth/authenticate';
import { notFound } from '../errors';

const DELETION_NOTICE =
  'Будут удалены: привязка к дому и квартире, согласия, присоединения к заявкам соседей ' +
  'и очередь уведомлений. Поданные вами заявки останутся у дома, но перестанут быть связаны ' +
  'с вами: они нужны управляющей организации и соседям, которые к ним присоединились. ' +
  'Войти заново можно в любой момент — это будет новый пользователь.';

/**
 * Права субъекта персональных данных: узнать состав, забрать копию, удалить.
 *
 * Сделано ручками API, а не письмом оператору, потому что так этим правом действительно
 * пользуются. Заодно видно, как мало мы храним: настоящий идентификатор MAX лежит
 * только в виде хеша и шифротекста, ФИО не хранится вовсе.
 */
export const privacyRoutes =
  (db: Db, clock: Clock, authenticate: preHandlerAsyncHookHandler): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/me/data', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);

      const [user] = await db
        .select({ createdAt: users.createdAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) throw notFound('Пользователь');

      const [membershipRows, consentRows, joinRows, requestRows, photoRows, outboxRows] =
        await Promise.all([
          db
            .select({
              role: memberships.role,
              apartmentLabel: memberships.apartmentLabel,
              areaM2: memberships.apartmentAreaM2,
              residents: memberships.residents,
              address: houses.address,
            })
            .from(memberships)
            .leftJoin(houses, eq(memberships.houseId, houses.id))
            .where(eq(memberships.userId, userId)),
          db
            .select({ docType: consents.docType, docVersion: consents.docVersion })
            .from(consents)
            .where(eq(consents.userId, userId)),
          db
            .select({ apartmentLabel: joins.apartmentLabel })
            .from(joins)
            .where(eq(joins.userId, userId)),
          db
            .select({ number: requests.number })
            .from(requests)
            .where(eq(requests.authorUserId, userId)),
          db.select({ key: photos.storageKey }).from(photos).where(eq(photos.uploadedBy, userId)),
          db.select({ id: outbox.id }).from(outbox).where(eq(outbox.userId, userId)),
        ]);

      const items: StoredItem[] = [
        {
          label: 'Идентификатор в MAX',
          count: 1,
          purpose: 'узнать вас при следующем входе и прислать уведомление; хранится в виде хеша',
        },
        {
          label: 'Привязка к дому и квартире',
          count: membershipRows.length,
          purpose: 'подать заявку по вашему дому и посчитать перерасчёт',
          values: membershipRows.map((m) =>
            [m.address, m.apartmentLabel, m.areaM2 ? `${m.areaM2} м²` : null]
              .filter(Boolean)
              .join(', '),
          ),
        },
        {
          label: 'Согласия',
          count: consentRows.length,
          purpose: 'подтвердить, какой текст и когда вы приняли',
          values: consentRows.map((c) => `${c.docType}, версия ${c.docVersion}`),
        },
        {
          label: 'Ваши заявки',
          count: requestRows.length,
          purpose: 'вести срок, считать перерасчёт и готовить документы',
          values: requestRows.map((r) => `№ ${r.number}`),
        },
        {
          label: 'Присоединения к заявкам соседей',
          count: joinRows.length,
          purpose: 'подтвердить масштаб проблемы в доме',
          values: joinRows.map((j) => j.apartmentLabel),
        },
        {
          label: 'Загруженные фотографии',
          count: photoRows.length,
          purpose: 'подтвердить нарушение при обращении в управляющую организацию',
        },
        {
          label: 'Очередь уведомлений',
          count: outboxRows.length,
          purpose: 'доставить сообщение о статусе заявки в MAX',
        },
      ];

      const data: MyData = {
        userId,
        createdAt: user.createdAt.toISOString(),
        items,
        deletionNotice: DELETION_NOTICE,
      };
      return data;
    });

    app.delete('/api/me', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);

      const result = await db.transaction(async (tx) => {
        const removedJoins = await tx.delete(joins).where(eq(joins.userId, userId)).returning({
          requestId: joins.requestId,
        });
        const removedConsents = await tx
          .delete(consents)
          .where(eq(consents.userId, userId))
          .returning({ id: consents.id });
        const removedMemberships = await tx
          .delete(memberships)
          .where(eq(memberships.userId, userId))
          .returning({ id: memberships.id });
        const removedOutbox = await tx
          .delete(outbox)
          .where(eq(outbox.userId, userId))
          .returning({ id: outbox.id });

        // Фотографии остаются доказательством по заявке, но перестают быть «вашими».
        await tx.update(photos).set({ uploadedBy: null }).where(eq(photos.uploadedBy, userId));

        const authored = await tx
          .select({ id: requests.id })
          .from(requests)
          .where(eq(requests.authorUserId, userId));

        // Заявки не удаляем: они нужны дому и соседям, которые к ним присоединились.
        // Вместо этого затираем то, по чему человека можно узнать, — хеш и шифротекст
        // идентификатора MAX. После этого строка пользователя больше никому не соответствует,
        // а следующий вход создаст нового пользователя.
        await tx
          .update(users)
          .set({ userHash: `deleted:${randomUUID()}`, userIdEnc: '' })
          .where(eq(users.id, userId));

        return {
          deleted: {
            memberships: removedMemberships.length,
            consents: removedConsents.length,
            joins: removedJoins.length,
            notifications: removedOutbox.length,
          },
          anonymizedRequests: authored.length,
        } satisfies DeleteMeResult;
      });

      app.log.info(
        { userId, at: clock.now().toISOString() },
        'удаление данных по требованию пользователя',
      );
      return result;
    });
  };

/** Есть ли у пользователя хоть одна подтверждённая привязка — нужно тестам и кабинету. */
export const hasMembership = async (db: Db, userId: string, role: 'resident' | 'dispatcher') => {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, role)))
    .limit(1);
  return Boolean(row);
};
