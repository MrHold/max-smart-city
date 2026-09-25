import {
  and,
  asc,
  type Db,
  type DbOrTx,
  enqueueNotification,
  eq,
  executors as executorsTable,
  houses,
  inArray,
  joins,
  measurements as measurementsTable,
  memberships,
  ne,
  photos,
  requestEvents,
  requests,
} from '@msc/db';
import {
  AcceptInputSchema,
  AssignInputSchema,
  type BulkResult,
  type Clock,
  type ClusterableRequest,
  CompleteInputSchema,
  calcLiability,
  checkQuality,
  cluster,
  type DispatcherInbox,
  type Executor,
  type Measurement,
  RejectInputSchema,
  type RequestStatus,
  transition,
  type WorkflowEvent,
} from '@msc/domain';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { getAuth } from '../auth/authenticate';
import type { RegionsData } from '../data/regions';
import { ApiError, badRequest, notFound } from '../errors';

const forbidden = (message: string) => new ApiError(403, 'forbidden', message);

interface DispatcherContext {
  orgId: string;
  orgName: string;
}

async function dispatcherOf(
  db: DbOrTx,
  userId: string,
  data: RegionsData,
): Promise<DispatcherContext | null> {
  const [row] = await db
    .select({ orgId: memberships.orgId })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'dispatcher')))
    .limit(1);

  if (!row?.orgId) return null;
  const org = data.regions.flatMap((r) => r.orgs).find((o) => o.id === row.orgId);
  return { orgId: row.orgId, orgName: org?.name ?? row.orgId };
}

const toMeasurement = (row: typeof measurementsTable.$inferSelect): Measurement => ({
  value: row.value,
  unit: 'celsius',
  measuredAt: row.measuredAt.toISOString(),
  place: row.place,
});

/**
 * Во сколько обойдётся простой по каждой заявке.
 *
 * Считается по замерам автора и числу присоединившихся квартир. Если правило требует данных,
 * которых нет, заявка попадает в кабинет без суммы: диспетчеру важнее увидеть её саму.
 */
function liabilityByRequest(
  rows: Array<typeof requests.$inferSelect>,
  measurementRows: Array<typeof measurementsTable.$inferSelect>,
  joinRows: Array<typeof joins.$inferSelect>,
  housesById: Map<string, { tz: string; regionCode: string }>,
  data: RegionsData,
  now: Date,
): Map<string, { kopecks: number; perHourKopecks: number }> {
  const result = new Map<string, { kopecks: number; perHourKopecks: number }>();

  for (const row of rows) {
    const house = housesById.get(row.houseId);
    const region = data.regions.find((r) => r.meta.code === house?.regionCode);
    const category = region?.categories.find((c) => c.code === row.category);
    if (!house || !region || !category?.service) {
      result.set(row.id, { kopecks: 0, perHourKopecks: 0 });
      continue;
    }

    const own = measurementRows
      .filter((m) => m.requestId === row.id && m.joinerUserId === null)
      .map(toMeasurement);
    const affected = 1 + joinRows.filter((j) => j.requestId === row.id).length;

    const input = {
      requestId: row.id,
      service: category.service,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      plannedNotice: row.plannedNotice,
      accident: row.accident,
      affectedApartments: affected,
      billing: {},
    };

    try {
      const quality = category.qualityRule
        ? data.rules.quality.find((r) => r.id === category.qualityRule)
        : undefined;
      const interruption = category.interruptionRule
        ? data.rules.interruption.find((r) => r.id === category.interruptionRule)
        : undefined;

      const liability = quality
        ? calcLiability(
            input,
            {
              quality: {
                rule: quality,
                verdict: checkQuality(own, quality, { tz: house.tz, until: row.endedAt ?? now }),
              },
            },
            region,
            now,
          )
        : interruption
          ? calcLiability(
              input,
              { interruption: { rule: interruption, measurements: own } },
              region,
              now,
            )
          : null;

      result.set(row.id, {
        kopecks: liability?.houseKopecks ?? 0,
        perHourKopecks: liability?.perHourHouseKopecks ?? 0,
      });
    } catch {
      result.set(row.id, { kopecks: 0, perHourKopecks: 0 });
    }
  }

  return result;
}

const rank: Record<RequestStatus, number> = {
  new: 0,
  reopened: 1,
  accepted: 2,
  assigned: 3,
  in_progress: 4,
  done: 5,
  confirmed: 6,
  rejected: 6,
};

export const dispatcherRoutes =
  (
    db: Db,
    data: RegionsData,
    clock: Clock,
    authenticate: preHandlerAsyncHookHandler,
  ): FastifyPluginAsync =>
  async (app) => {
    const requireDispatcher = async (userId: string): Promise<DispatcherContext> => {
      const ctx = await dispatcherOf(db, userId, data);
      if (!ctx) throw forbidden('Доступ только для диспетчера управляющей организации');
      return ctx;
    };

    /** Заявки домов этой организации: общая выборка для кабинета и массовых действий. */
    const orgRequests = async (orgId: string) => {
      const orgHouses = await db
        .select({ id: houses.id, tz: houses.tz, regionCode: houses.regionCode })
        .from(houses)
        .where(eq(houses.orgId, orgId));
      if (orgHouses.length === 0)
        return { orgHouses, rows: [] as Array<typeof requests.$inferSelect> };

      const rows = await db
        .select()
        .from(requests)
        .where(
          inArray(
            requests.houseId,
            orgHouses.map((h) => h.id),
          ),
        )
        .orderBy(asc(requests.startedAt));

      return { orgHouses, rows };
    };

    app.get('/api/dispatcher/inbox', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const ctx = await requireDispatcher(userId);
      const now = clock.now();

      const { orgHouses, rows } = await orgRequests(ctx.orgId);
      const housesById = new Map(
        orgHouses.map((h) => [h.id, { tz: h.tz, regionCode: h.regionCode }]),
      );
      const addressById = new Map(orgHouses.map((h) => [h.id, h]));

      const ids = rows.map((r) => r.id);
      const [measurementRows, joinRows] = ids.length
        ? await Promise.all([
            db.select().from(measurementsTable).where(inArray(measurementsTable.requestId, ids)),
            db.select().from(joins).where(inArray(joins.requestId, ids)),
          ])
        : [[], []];

      const money = liabilityByRequest(rows, measurementRows, joinRows, housesById, data, now);

      const clusterable: ClusterableRequest[] = rows.map((r) => ({
        id: r.id,
        houseId: r.houseId,
        category: r.category,
        status: r.status as RequestStatus,
        startedAt: r.startedAt,
        dueAt: r.dueAt,
        joinersCount: joinRows.filter((j) => j.requestId === r.id).length,
        houseKopecks: money.get(r.id)?.kopecks ?? 0,
        perHourHouseKopecks: money.get(r.id)?.perHourKopecks ?? 0,
      }));

      const byId = new Map(rows.map((r) => [r.id, r]));
      const addresses = await db
        .select({ id: houses.id, address: houses.address })
        .from(houses)
        .where(
          inArray(houses.id, [...addressById.keys()].length ? [...addressById.keys()] : ['—']),
        );
      const addressOf = new Map(addresses.map((h) => [h.id, h.address]));

      const executorRows = await db
        .select()
        .from(executorsTable)
        .where(eq(executorsTable.orgId, ctx.orgId));

      // Время визита хранится в событии назначения: отдельной колонки под него нет.
      const assignedEvents = ids.length
        ? await db
            .select({ requestId: requestEvents.requestId, payload: requestEvents.payload })
            .from(requestEvents)
            .where(and(inArray(requestEvents.requestId, ids), eq(requestEvents.type, 'assigned')))
            .orderBy(asc(requestEvents.at))
        : [];
      const plannedByRequest = new Map(
        assignedEvents.map((e) => [
          e.requestId,
          (e.payload as { plannedAt?: string | null } | null)?.plannedAt ?? null,
        ]),
      );

      const clusters = cluster(clusterable, now).map((c) => {
        const members = c.requestIds.map((id) => byId.get(id)).filter((r) => r !== undefined);
        const region = data.regions.find(
          (r) => r.meta.code === housesById.get(c.houseId)?.regionCode,
        );
        const category = region?.categories.find((cat) => cat.code === c.category);
        const leader = members.reduce((min, r) =>
          rank[r.status as RequestStatus] < rank[min.status as RequestStatus] ? r : min,
        );
        const assigned = members.find((r) => r.executorId !== null);
        const executor = assigned
          ? executorRows.find((e) => e.id === assigned.executorId)
          : undefined;

        return {
          key: c.key,
          houseId: c.houseId,
          houseAddress: addressOf.get(c.houseId) ?? '',
          category: c.category,
          title: category?.title ?? c.category,
          kind: category?.kind ?? 'repair',
          status: leader.status as RequestStatus,
          requestIds: c.requestIds,
          apartments: c.apartments,
          startedAt: c.startedAt.toISOString(),
          dueAt: c.dueAt.toISOString(),
          overdue: c.overdue,
          kopecks: c.kopecks,
          perHourKopecks: c.perHourKopecks,
          executor: executor
            ? {
                id: executor.id,
                nameShort: executor.nameShort,
                plannedAt: assigned ? (plannedByRequest.get(assigned.id) ?? null) : null,
              }
            : null,
        };
      });

      const inbox: DispatcherInbox = {
        orgName: ctx.orgName,
        now: now.toISOString(),
        clusters,
        totalKopecks: clusters.reduce((sum, c) => sum + c.kopecks, 0),
        totalPerHourKopecks: clusters.reduce((sum, c) => sum + c.perHourKopecks, 0),
      };
      return inbox;
    });

    /**
     * Демо-режим: жюри проходит сценарий одним аккаунтом, второго человека для роли
     * диспетчера нет. Эта ручка выдаёт роль диспетчера организации, которая управляет
     * домом пользователя. В обычном режиме выключена.
     */
    app.post('/api/demo/dispatcher', { preHandler: authenticate }, async (req) => {
      if (process.env.DEMO_MODE !== '1') throw notFound('Адрес');
      const { userId } = getAuth(req);

      const [resident] = await db
        .select({ houseId: memberships.houseId })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.role, 'resident')))
        .limit(1);
      if (!resident?.houseId) throw badRequest('Сначала выберите свой дом');

      const [house] = await db
        .select({ orgId: houses.orgId })
        .from(houses)
        .where(eq(houses.id, resident.houseId))
        .limit(1);
      if (!house?.orgId) throw notFound('Организация дома');

      const [existing] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.role, 'dispatcher')))
        .limit(1);

      if (!existing) {
        await db
          .insert(memberships)
          .values({ userId, role: 'dispatcher', orgId: house.orgId, confirmed: true });
      }

      const ctx = await requireDispatcher(userId);
      return { role: 'dispatcher', orgId: ctx.orgId, orgName: ctx.orgName };
    });

    app.get('/api/dispatcher/executors', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const ctx = await requireDispatcher(userId);

      const rows = await db
        .select()
        .from(executorsTable)
        .where(eq(executorsTable.orgId, ctx.orgId));

      return rows.map(
        (e): Executor => ({ id: e.id, nameShort: e.nameShort, categories: e.categories }),
      );
    });

    /**
     * Массовое действие над кластером: диспетчер нажимает один раз, а меняются все заявки
     * этой причины. Заявки, для которых переход недопустим, пропускаются с объяснением —
     * из-за одной чужой строки не должно падать всё действие.
     */
    async function bulk(
      userId: string,
      requestIds: string[],
      event: WorkflowEvent,
      apply: (row: typeof requests.$inferSelect) => Record<string, unknown>,
      eventType: string,
      payload: (row: typeof requests.$inferSelect) => Record<string, unknown> = () => ({}),
      notify?: (row: typeof requests.$inferSelect) => Record<string, unknown>,
      /** Второй адресат уведомления — например, исполнитель, получающий наряд. */
      notifyAlso?: (
        row: typeof requests.$inferSelect,
      ) => { userId: string; payload: Record<string, unknown> } | null,
    ): Promise<BulkResult> {
      const ctx = await requireDispatcher(userId);
      const now = clock.now();

      const rows = await db.select().from(requests).where(inArray(requests.id, requestIds));
      if (rows.length === 0) throw notFound('Заявка');

      const orgHouses = await db
        .select({ id: houses.id })
        .from(houses)
        .where(eq(houses.orgId, ctx.orgId));
      const allowed = new Set(orgHouses.map((h) => h.id));

      const skipped: BulkResult['skipped'] = [];
      let updated = 0;

      await db.transaction(async (tx) => {
        for (const row of rows) {
          if (!allowed.has(row.houseId)) {
            skipped.push({ requestId: row.id, reason: 'Дом другой организации' });
            continue;
          }

          let next: RequestStatus;
          try {
            next = transition(row.status as RequestStatus, event);
          } catch {
            skipped.push({ requestId: row.id, reason: `Статус «${row.status}» не позволяет` });
            continue;
          }

          await tx
            .update(requests)
            .set({ status: next, updatedAt: now, ...apply(row) })
            .where(eq(requests.id, row.id));

          await tx.insert(requestEvents).values({
            requestId: row.id,
            type: eventType,
            actorUserId: userId,
            payload: payload(row),
          });

          if (notify) await enqueueNotification(tx, row.authorUserId, notify(row));
          const extra = notifyAlso?.(row);
          if (extra) await enqueueNotification(tx, extra.userId, extra.payload);
          updated++;
        }
      });

      return { updated, skipped };
    }

    app.post('/api/dispatcher/accept', { preHandler: authenticate }, async (req) => {
      const parsed = AcceptInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите заявки');
      return bulk(
        getAuth(req).userId,
        parsed.data.requestIds,
        'accept',
        () => ({}),
        'accepted',
        () => ({}),
        (row) => ({ type: 'accepted', requestId: row.id, number: row.number }),
      );
    });

    app.post('/api/dispatcher/reject', { preHandler: authenticate }, async (req) => {
      const parsed = RejectInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите заявки и причину отказа');
      const { reason } = parsed.data;
      return bulk(
        getAuth(req).userId,
        parsed.data.requestIds,
        'reject',
        () => ({}),
        'rejected',
        () => ({ reason }),
        (row) => ({ type: 'rejected', requestId: row.id, number: row.number, reason }),
      );
    });

    app.post('/api/dispatcher/assign', { preHandler: authenticate }, async (req) => {
      const parsed = AssignInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите заявки и исполнителя');
      const { executorId, plannedAt } = parsed.data;

      const { userId } = getAuth(req);
      const ctx = await requireDispatcher(userId);
      const [executor] = await db
        .select()
        .from(executorsTable)
        .where(and(eq(executorsTable.id, executorId), eq(executorsTable.orgId, ctx.orgId)))
        .limit(1);
      if (!executor) throw notFound('Исполнитель');

      // Адреса нужны наряду: исполнителю бесполезен номер заявки без дома.
      const addressRows = await db
        .select({ requestId: requests.id, address: houses.address, category: requests.category })
        .from(requests)
        .innerJoin(houses, eq(requests.houseId, houses.id))
        .where(inArray(requests.id, parsed.data.requestIds));
      const addressOf = new Map(addressRows.map((r) => [r.requestId, r.address]));

      return bulk(
        userId,
        parsed.data.requestIds,
        'assign',
        () => ({ executorId }),
        'assigned',
        () => ({ executorId, nameShort: executor.nameShort, plannedAt: plannedAt ?? null }),
        (row) => ({
          type: 'assigned',
          requestId: row.id,
          number: row.number,
          nameShort: executor.nameShort,
          plannedAt: plannedAt ?? null,
        }),
        // Наряд самому исполнителю — если он привязан к аккаунту MAX.
        // Пока привязки нет, наряд просто не отправляется: заявка всё равно назначена.
        (row) =>
          executor.userId
            ? {
                userId: executor.userId,
                payload: {
                  type: 'order',
                  requestId: row.id,
                  number: row.number,
                  address: addressOf.get(row.id) ?? '',
                  category: row.category,
                  description: row.description,
                  plannedAt: plannedAt ?? null,
                },
              }
            : null,
      );
    });

    app.post('/api/dispatcher/complete', { preHandler: authenticate }, async (req) => {
      const parsed = CompleteInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите заявки');
      const { requestIds, photoKeys } = parsed.data;
      const { userId } = getAuth(req);
      const now = clock.now();

      const result = await bulk(
        userId,
        requestIds,
        'complete',
        () => ({ endedAt: now }),
        'completed',
        () => ({ photos: photoKeys.length }),
        (row) => ({ type: 'completed', requestId: row.id, number: row.number }),
      );

      // Фото «после» прикрепляются ко всем заявкам кластера: работа одна на всех.
      if (photoKeys.length > 0) {
        await db
          .update(photos)
          .set({ requestId: requestIds[0] as string, stage: 'after' })
          .where(and(inArray(photos.storageKey, photoKeys), ne(photos.stage, 'after')));
      }

      return result;
    });
  };
