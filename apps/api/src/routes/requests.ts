import {
  and,
  asc,
  type Db,
  type DbOrTx,
  desc,
  enqueueNotification,
  eq,
  houses,
  inArray,
  joins,
  measurements as measurementsTable,
  memberships,
  nextRequestNumber,
  photos,
  requestEvents,
  requests,
} from '@msc/db';
import {
  type Clock,
  ConfirmInputSchema,
  calcLiability,
  checkQuality,
  dueAt as computeDueAt,
  escalation,
  isClosed,
  JoinInputSchema,
  type Liability,
  type Location,
  type Measurement,
  NewRequestInputSchema,
  type RegionCategory,
  type RegionPackage,
  type RequestDetail,
  type RequestStatus,
  type RequestSummary,
  transition,
} from '@msc/domain';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { getAuth } from '../auth/authenticate';
import type { RegionsData } from '../data/regions';
import { ApiError, badRequest, notFound } from '../errors';

const forbidden = (message: string) => new ApiError(403, 'forbidden', message);
const conflict = (message: string) => new ApiError(409, 'conflict', message);

const eventLabels: Record<string, string> = {
  created: 'Заявка отправлена',
  accepted: 'Принята диспетчером',
  assigned: 'Исполнитель назначен',
  started: 'Взята в работу',
  completed: 'Выполнена',
  confirmed: 'Вы подтвердили',
  reopened: 'Возвращена в работу',
  rejected: 'Отклонена',
  joined: 'Сосед присоединился',
};

function locationText(location: Location): string {
  const parts: string[] = [];
  if (location.scope === 'apartment') parts.push('Моя квартира');
  if (location.scope === 'yard') parts.push('Двор');
  if (location.scope === 'entrance') parts.push(`Подъезд ${location.entrance ?? '—'}`);
  if (location.scope === 'floor')
    parts.push(`Подъезд ${location.entrance ?? '—'}, этаж ${location.floor ?? '—'}`);
  if (location.note) parts.push(location.note);
  return parts.join(', ');
}

interface Resident {
  houseId: string;
  apartmentLabel: string;
  areaM2: number | null;
  residents: number | null;
  monthlyChargeKopecks: number | null;
}

async function resident(db: DbOrTx, userId: string): Promise<Resident | null> {
  const [row] = await db
    .select({
      houseId: memberships.houseId,
      apartmentLabel: memberships.apartmentLabel,
      areaM2: memberships.apartmentAreaM2,
      residents: memberships.residents,
      monthlyChargeKopecks: memberships.monthlyChargeKopecks,
    })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'resident')))
    .limit(1);

  if (!row?.houseId) return null;
  return {
    houseId: row.houseId,
    apartmentLabel: row.apartmentLabel ?? '',
    areaM2: row.areaM2,
    residents: row.residents,
    monthlyChargeKopecks: row.monthlyChargeKopecks,
  };
}

function regionOf(data: RegionsData, regionCode: string): RegionPackage {
  const region = data.regions.find((r) => r.meta.code === regionCode);
  if (!region) throw new ApiError(500, 'internal', `Нет пакета региона ${regionCode}`);
  return region;
}

function categoryOf(region: RegionPackage, code: string): RegionCategory {
  const category = region.categories.find((c) => c.code === code);
  if (!category) throw badRequest('Неизвестная категория');
  return category;
}

/**
 * Считает сумму снижения платы по заявке.
 *
 * Возвращает null там, где денег не бывает в принципе: ремонтные категории без норматива
 * качества, а также случаи, когда правило требует данных, которых у нас нет. Ошибку наружу
 * не пускаем: карточка заявки должна открыться в любом случае, просто без суммы.
 */
function liabilityOf(
  args: {
    requestId: string;
    category: RegionCategory;
    region: RegionPackage;
    rules: RegionsData['rules'];
    tz: string;
    startedAt: Date;
    endedAt: Date | null;
    plannedNotice: boolean | null;
    accident: boolean;
    measurements: Measurement[];
    affectedApartments: number;
    billing: Resident | null;
  },
  now: Date,
): Liability | null {
  const { category, rules } = args;
  const service = category.service;
  if (!service) return null;

  const input = {
    requestId: args.requestId,
    service,
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    plannedNotice: args.plannedNotice,
    accident: args.accident,
    affectedApartments: args.affectedApartments,
    billing: {
      monthlyChargeKopecks: args.billing?.monthlyChargeKopecks ?? null,
      apartmentAreaM2: args.billing?.areaM2 ?? null,
      residents: args.billing?.residents ?? null,
    },
  };

  try {
    if (category.qualityRule) {
      const rule = rules.quality.find((r) => r.id === category.qualityRule);
      if (!rule) return null;
      const verdict = checkQuality(args.measurements, rule, {
        tz: args.tz,
        until: args.endedAt ?? now,
      });
      return calcLiability(input, { quality: { rule, verdict } }, args.region, now);
    }

    if (category.interruptionRule) {
      const rule = rules.interruption.find((r) => r.id === category.interruptionRule);
      if (!rule) return null;
      return calcLiability(
        input,
        { interruption: { rule, measurements: args.measurements } },
        args.region,
        now,
      );
    }
  } catch {
    return null;
  }

  return null;
}

type RequestRow = typeof requests.$inferSelect;

const toMeasurement = (row: typeof measurementsTable.$inferSelect): Measurement => ({
  value: row.value,
  unit: 'celsius',
  measuredAt: row.measuredAt.toISOString(),
  place: row.place,
});

const shareUrlFor = (id: string): string => {
  const link = process.env.APP_LINK;
  return link ? `${link}?startapp=r_${id}` : '';
};

async function buildDetail(
  db: DbOrTx,
  data: RegionsData,
  row: RequestRow,
  viewerUserId: string,
  now: Date,
): Promise<RequestDetail> {
  const [house] = await db
    .select({ tz: houses.tz, regionCode: houses.regionCode })
    .from(houses)
    .where(eq(houses.id, row.houseId))
    .limit(1);
  if (!house) throw notFound('Дом');

  const region = regionOf(data, house.regionCode);
  const category = categoryOf(region, row.category);

  const [measurementRows, joinRows, eventRows, photoRows] = await Promise.all([
    db
      .select()
      .from(measurementsTable)
      .where(eq(measurementsTable.requestId, row.id))
      .orderBy(asc(measurementsTable.measuredAt)),
    db.select().from(joins).where(eq(joins.requestId, row.id)).orderBy(asc(joins.joinedAt)),
    db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, row.id))
      .orderBy(asc(requestEvents.at)),
    db.select().from(photos).where(eq(photos.requestId, row.id)).orderBy(asc(photos.at)),
  ]);

  const authorBilling = await resident(db, row.authorUserId);
  // Снижение платы автору считается по его собственным замерам. Замеры соседей
  // подтверждают масштаб и нужны для акта, но чужой градусник не увеличивает
  // перерасчёт по чужой квартире.
  const measurements = measurementRows.filter((m) => m.joinerUserId === null).map(toMeasurement);

  const liability = liabilityOf(
    {
      requestId: row.id,
      category,
      region,
      rules: data.rules,
      tz: house.tz,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      plannedNotice: row.plannedNotice,
      accident: row.accident,
      measurements,
      affectedApartments: 1 + joinRows.length,
      billing: authorBilling,
    },
    now,
  );

  const status = row.status as RequestStatus;
  const steps = escalation({
    status,
    dueAt: row.dueAt,
    now,
    hasLiability: (liability?.apartmentKopecks ?? 0) > 0,
  });

  const isAuthor = row.authorUserId === viewerUserId;
  const viewer = await resident(db, viewerUserId);
  const alreadyJoined = joinRows.some((j) => j.userId === viewerUserId);

  return {
    id: row.id,
    number: row.number,
    title: category.title,
    kind: category.kind,
    status,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    overdue: !isClosed(status) && now.getTime() > row.dueAt.getTime(),
    locationText: locationText(row.location as Location),
    joinersCount: joinRows.length,
    service: category.service ?? null,
    description: row.description,
    location: row.location as Location,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    plannedNotice: row.plannedNotice,
    measurements,
    photos: photoRows.map((p) => ({ key: p.storageKey, url: `/api/photos/${p.storageKey}` })),
    events: eventRows.map((e) => ({
      type: e.type,
      label: eventLabels[e.type] ?? e.type,
      at: e.at.toISOString(),
    })),
    joiners: joinRows.map((j) => ({
      apartmentLabel: j.apartmentLabel,
      joinedAt: j.joinedAt.toISOString(),
    })),
    liability,
    executor: null,
    isAuthor,
    canJoin:
      !isAuthor &&
      !alreadyJoined &&
      !isClosed(status) &&
      viewer !== null &&
      viewer.houseId === row.houseId,
    shareUrl: shareUrlFor(row.id),
    claim: { available: steps.claim.available, url: null },
    gji: steps.gji,
  };
}

const toSummary = (
  row: RequestRow,
  title: string,
  kind: RequestDetail['kind'],
  joinersCount: number,
  now: Date,
): RequestSummary => ({
  id: row.id,
  number: row.number,
  title,
  kind,
  status: row.status as RequestStatus,
  createdAt: row.createdAt.toISOString(),
  dueAt: row.dueAt.toISOString(),
  overdue: !isClosed(row.status as RequestStatus) && now.getTime() > row.dueAt.getTime(),
  locationText: locationText(row.location as Location),
  joinersCount,
});

export const requestsRoutes =
  (
    db: Db,
    data: RegionsData,
    clock: Clock,
    authenticate: preHandlerAsyncHookHandler,
  ): FastifyPluginAsync =>
  async (app) => {
    const demoMode = process.env.DEMO_MODE === '1';

    async function loadRequest(id: string): Promise<RequestRow> {
      const [row] = await db.select().from(requests).where(eq(requests.id, id)).limit(1);
      if (!row) throw notFound('Заявка');
      return row;
    }

    // Мои заявки: поданные мной и те, к которым я присоединился.
    app.get('/api/requests', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const now = clock.now();

      const joined = await db
        .select({ requestId: joins.requestId })
        .from(joins)
        .where(eq(joins.userId, userId));
      const ids = joined.map((j) => j.requestId);

      const mine = await db
        .select()
        .from(requests)
        .where(eq(requests.authorUserId, userId))
        .orderBy(desc(requests.createdAt));
      const asNeighbour = ids.length
        ? await db.select().from(requests).where(inArray(requests.id, ids))
        : [];

      const all = [...mine, ...asNeighbour].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
      if (all.length === 0) return [];

      const counts = await db
        .select({ requestId: joins.requestId })
        .from(joins)
        .where(
          inArray(
            joins.requestId,
            all.map((r) => r.id),
          ),
        );

      const houseRows = await db
        .select({ id: houses.id, regionCode: houses.regionCode })
        .from(houses)
        .where(inArray(houses.id, [...new Set(all.map((r) => r.houseId))]));
      const regionByHouse = new Map(houseRows.map((h) => [h.id, h.regionCode]));

      return all.map((row) => {
        const region = regionOf(data, regionByHouse.get(row.houseId) ?? '');
        const category = categoryOf(region, row.category);
        const joinersCount = counts.filter((c) => c.requestId === row.id).length;
        return toSummary(row, category.title, category.kind, joinersCount, now);
      });
    });

    // Создание заявки. Срок считается по норме из rules/federal, а не задаётся руками.
    app.post('/api/requests', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const now = clock.now();

      const parsed = NewRequestInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Проверьте заполненные поля');
      const input = parsed.data;

      const me = await resident(db, userId);
      if (!me) throw badRequest('Сначала выберите свой дом');

      const [house] = await db
        .select({ id: houses.id, tz: houses.tz, regionCode: houses.regionCode })
        .from(houses)
        .where(eq(houses.id, me.houseId))
        .limit(1);
      if (!house) throw notFound('Дом');

      const region = regionOf(data, house.regionCode);
      const category = categoryOf(region, input.category);

      const startedAt = new Date(input.startedAt);
      if (startedAt.getTime() > now.getTime())
        throw badRequest('Дата начала не может быть в будущем');

      // Для перерыва отопления допустимая продолжительность зависит от температуры
      // в квартире, поэтому без замера заявку принять нельзя — иначе нечего считать.
      const interruptionRule = category.interruptionRule
        ? data.rules.interruption.find((r) => r.id === category.interruptionRule)
        : undefined;
      if (
        interruptionRule?.limits.singleHoursByIndoorTemperature &&
        input.measurements.length === 0
      ) {
        throw badRequest('Укажите температуру в квартире — от неё зависит допустимое время');
      }

      const deadlineRule = data.rules.deadlines.find((d) => d.id === category.slaRule);
      if (!deadlineRule) throw new ApiError(500, 'internal', `Нет срока ${category.slaRule}`);
      const due = computeDueAt(startedAt, deadlineRule, {
        calendar: data.rules.calendar,
        tz: house.tz,
      });

      const id = await db.transaction(async (tx) => {
        const number = await nextRequestNumber(tx, now.getUTCFullYear());
        const [created] = await tx
          .insert(requests)
          .values({
            number,
            houseId: house.id,
            authorUserId: userId,
            category: category.code,
            kind: category.kind,
            service: category.service ?? null,
            location: input.location,
            description: input.description,
            startedAt,
            plannedNotice: input.plannedNotice,
            status: demoMode ? 'accepted' : 'new',
            dueAt: due,
          })
          .returning({ id: requests.id });
        if (!created) throw new ApiError(500, 'internal', 'Не удалось создать заявку');

        if (input.measurements.length) {
          await tx.insert(measurementsTable).values(
            input.measurements.map((m) => ({
              requestId: created.id,
              value: m.value,
              unit: m.unit,
              measuredAt: new Date(m.measuredAt),
              place: m.place,
            })),
          );
        }

        if (input.photoKeys.length) {
          await tx
            .update(photos)
            .set({ requestId: created.id })
            .where(and(inArray(photos.storageKey, input.photoKeys), eq(photos.uploadedBy, userId)));
        }

        await tx.insert(requestEvents).values({
          requestId: created.id,
          type: 'created',
          actorUserId: userId,
          payload: { number },
        });
        // В демо-режиме диспетчера нет, поэтому заявка принимается сама:
        // иначе основной сценарий не пройти без второго аккаунта.
        if (demoMode) {
          await tx.insert(requestEvents).values({ requestId: created.id, type: 'accepted' });
        }

        return created.id;
      });

      return buildDetail(db, data, await loadRequest(id), userId, now);
    });

    app.get('/api/requests/:id', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const { id } = req.params as { id: string };
      const row = await loadRequest(id);

      const me = await resident(db, userId);
      // Заявку видят автор, присоединившиеся соседи и жители того же дома:
      // без этого нельзя присоединиться по ссылке из чата дома.
      if (row.authorUserId !== userId && me?.houseId !== row.houseId) {
        throw forbidden('Заявка другого дома');
      }

      return buildDetail(db, data, row, userId, clock.now());
    });

    // «У меня тоже»: сосед подтверждает, что проблема касается и его квартиры.
    app.post('/api/requests/:id/join', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const { id } = req.params as { id: string };
      const now = clock.now();

      const parsed = JoinInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите номер квартиры');

      const row = await loadRequest(id);
      if (isClosed(row.status as RequestStatus)) throw conflict('Заявка уже закрыта');
      if (row.authorUserId === userId) throw conflict('Это ваша заявка');

      const me = await resident(db, userId);
      if (!me) throw badRequest('Сначала выберите свой дом');
      if (me.houseId !== row.houseId) throw forbidden('Заявка другого дома');

      const [existing] = await db
        .select({ userId: joins.userId })
        .from(joins)
        .where(and(eq(joins.requestId, id), eq(joins.userId, userId)))
        .limit(1);
      if (existing) throw conflict('Вы уже присоединились');

      await db.transaction(async (tx) => {
        await tx.insert(joins).values({
          requestId: id,
          userId,
          apartmentLabel: parsed.data.apartmentLabel,
        });

        if (parsed.data.measurements.length) {
          await tx.insert(measurementsTable).values(
            parsed.data.measurements.map((m) => ({
              requestId: id,
              joinerUserId: userId,
              value: m.value,
              unit: m.unit,
              measuredAt: new Date(m.measuredAt),
              place: m.place,
            })),
          );
        }

        await tx.insert(requestEvents).values({
          requestId: id,
          type: 'joined',
          actorUserId: userId,
          // Номер квартиры соседа виден: без него акт не составить. Имя не показываем.
          payload: { apartmentLabel: parsed.data.apartmentLabel },
        });

        await enqueueNotification(tx, row.authorUserId, {
          type: 'joined',
          requestId: id,
          number: row.number,
          apartmentLabel: parsed.data.apartmentLabel,
        });
      });

      return buildDetail(db, data, await loadRequest(id), userId, now);
    });

    // Приёмка работы жителем. Отказ возвращает заявку в работу и перезапускает срок.
    app.post('/api/requests/:id/confirm', { preHandler: authenticate }, async (req) => {
      const { userId } = getAuth(req);
      const { id } = req.params as { id: string };
      const now = clock.now();

      const parsed = ConfirmInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите, принята ли работа');

      const row = await loadRequest(id);
      if (row.authorUserId !== userId) throw forbidden('Подтвердить может только автор заявки');

      const status = row.status as RequestStatus;
      const accepted = parsed.data.accepted;
      // Недопустимый переход — это состояние заявки, а не сбой сервера:
      // отвечаем 409 с объяснением, а не 500.
      let next: RequestStatus;
      try {
        next = transition(status, accepted ? 'confirm' : 'reopen');
      } catch {
        throw conflict(
          accepted
            ? 'Подтверждать пока нечего: работа ещё не отмечена выполненной'
            : 'Вернуть в работу можно только выполненную заявку',
        );
      }

      const [house] = await db
        .select({ tz: houses.tz })
        .from(houses)
        .where(eq(houses.id, row.houseId))
        .limit(1);
      if (!house) throw notFound('Дом');

      const region = regionOf(
        data,
        (
          await db
            .select({ regionCode: houses.regionCode })
            .from(houses)
            .where(eq(houses.id, row.houseId))
            .limit(1)
        )[0]?.regionCode ?? '',
      );
      const category = categoryOf(region, row.category);
      const deadlineRule = data.rules.deadlines.find((d) => d.id === category.slaRule);
      if (!deadlineRule) throw new ApiError(500, 'internal', `Нет срока ${category.slaRule}`);

      await db.transaction(async (tx) => {
        await tx
          .update(requests)
          .set({
            status: next,
            updatedAt: now,
            endedAt: accepted ? (row.endedAt ?? now) : null,
            // Возврат в работу перезапускает срок: старый уже истёк или вот-вот истечёт,
            // и оставлять его означало бы «просрочено навсегда».
            dueAt: accepted
              ? row.dueAt
              : computeDueAt(now, deadlineRule, { calendar: data.rules.calendar, tz: house.tz }),
          })
          .where(eq(requests.id, id));

        await tx.insert(requestEvents).values({
          requestId: id,
          type: accepted ? 'confirmed' : 'reopened',
          actorUserId: userId,
          payload: parsed.data.note ? { note: parsed.data.note } : {},
        });
      });

      return buildDetail(db, data, await loadRequest(id), userId, now);
    });
  };
