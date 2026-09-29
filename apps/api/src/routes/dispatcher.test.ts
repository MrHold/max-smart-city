import { randomBytes } from 'node:crypto';
import { createDb, eq, parseEncKey, photos, runMigrations, sql, verifyInvite } from '@msc/db';
import { DispatcherInboxSchema, ExecutorSchema, RequestDetailSchema } from '@msc/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { signInitData } from '../auth/init-data';
import { loadRegionsData, regionsDataSource } from '../data/regions';
import { seedFromRegions } from '../data/seed';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const BOT_TOKEN = 'test-token';
const auth: AuthConfig = {
  botToken: BOT_TOKEN,
  hashSecret: 'test-hash-secret',
  encKey: parseEncKey(randomBytes(32).toString('base64')),
  maxAgeSec: 3600,
};

const HOUSE = 'house-16-kazan-001';
const OTHER_HOUSE = 'house-16-kazan-002';
const NOW = new Date('2026-11-10T09:30:00Z');
const STARTED = '2026-11-10T03:30:00.000Z';

const initDataFor = (id: number, name: string) =>
  signInitData(
    {
      auth_date: String(Math.floor(NOW.getTime() / 1000)),
      query_id: `disp-${id}`,
      user: JSON.stringify({ id, first_name: name, language_code: 'ru' }),
    },
    BOT_TOKEN,
  );

const DISPATCHER = initDataFor(8001, 'Диспетчер');
const RESIDENT = initDataFor(8002, 'Житель');
const NEIGHBOUR = initDataFor(8003, 'Сосед');

suite('кабинет диспетчера', () => {
  const { db, pool } = createDb(url as string);
  let app: ReturnType<typeof buildApp>;
  let regions: Awaited<ReturnType<typeof loadRegionsData>>;

  const call = (method: 'GET' | 'POST', path: string, initData: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { 'x-init-data': initData },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const bind = (initData: string, houseId: string, apartmentLabel: string) =>
    call('POST', '/api/me/house', initData, { houseId, apartmentLabel });

  /** Загружает тестовый PNG от имени initData и возвращает его ключ хранения. */
  const uploadPhoto = async (initData: string) => {
    const boundary = '----msc-test-boundary';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="thermo.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/photos',
      headers: {
        'x-init-data': initData,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().key as string;
  };

  const createRequest = async (initData: string, category = 'heating') => {
    const res = await call('POST', '/api/requests', initData, {
      category,
      location: { scope: 'apartment' },
      description: 'Батареи еле тёплые',
      startedAt: STARTED,
      measurements: [{ value: 15, unit: 'celsius', measuredAt: STARTED, place: 'room' }],
      plannedNotice: null,
      photoKeys: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    return RequestDetailSchema.parse(res.json());
  };

  const createAccepted = async (initData: string, category = 'heating') => {
    const created = await createRequest(initData, category);
    const res = await call('POST', '/api/dispatcher/accept', DISPATCHER, {
      requestIds: [created.id],
    });
    expect(res.json().updated, res.body).toBe(1);
    return created;
  };

  const inbox = async () => {
    const res = await call('GET', '/api/dispatcher/inbox', DISPATCHER);
    expect(res.statusCode, res.body).toBe(200);
    return DispatcherInboxSchema.parse(res.json());
  };

  beforeAll(async () => {
    process.env.DEMO_MODE = '1';
    await runMigrations(url as string);
    regions = await loadRegionsData();
    await seedFromRegions(db, regions);
    app = buildApp({
      data: regionsDataSource(regions),
      regions,
      db,
      auth,
      clock: { now: () => NOW },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table requests, joins, measurements, request_events, outbox, memberships, users restart identity cascade`,
    );
    // Исполнители ссылаются на пользователей, поэтому cascade сносит и их: возвращаем справочники.
    await seedFromRegions(db, regions);
    await bind(RESIDENT, HOUSE, 'кв. 12');
    await bind(NEIGHBOUR, HOUSE, 'кв. 45');
    await bind(DISPATCHER, HOUSE, 'кв. 1');
    await call('POST', '/api/demo/dispatcher', DISPATCHER);
  });

  it('житель в кабинет не попадает', async () => {
    const res = await call('GET', '/api/dispatcher/inbox', RESIDENT);
    expect(res.statusCode).toBe(403);
  });

  it('одна причина в доме — одна строка с масштабом и ценой простоя', async () => {
    const first = await createRequest(RESIDENT);
    await call('POST', `/api/requests/${first.id}/join`, NEIGHBOUR, {
      apartmentLabel: 'кв. 45',
      measurements: [],
    });

    const data = await inbox();
    expect(data.clusters).toHaveLength(1);
    const card = data.clusters[0];
    expect(card?.title).toBe('Холодные батареи');
    expect(card?.apartments).toBe(2);
    expect(card?.overdue).toBe(true);
    expect(card?.kopecks).toBeGreaterThan(0);
    expect(card?.perHourKopecks).toBeGreaterThan(0);
    expect(data.totalKopecks).toBe(card?.kopecks);
  });

  it('новая заявка приходит во входящие непринятой, в том числе в демо-режиме', async () => {
    await createRequest(RESIDENT);
    expect((await inbox()).clusters[0]?.status).toBe('new');
  });

  it('заявки жителей разных домов не смешиваются', async () => {
    await createRequest(RESIDENT);
    await bind(NEIGHBOUR, OTHER_HOUSE, 'кв. 3');
    await createRequest(NEIGHBOUR);

    const data = await inbox();
    expect(data.clusters).toHaveLength(2);
    expect(new Set(data.clusters.map((c) => c.houseId)).size).toBe(2);
  });

  it('отдаёт исполнителей организации', async () => {
    const res = await call('GET', '/api/dispatcher/executors', DISPATCHER);
    const list = res.json().map((e: unknown) => ExecutorSchema.parse(e));
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((e: { categories: string[] }) => e.categories.includes('heating'))).toBe(true);
  });

  it('исполнители: видно, подключён ли к боту, и есть ссылка-приглашение', async () => {
    const list = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    const first = ExecutorSchema.parse(list[0]);
    expect(typeof first.inBot).toBe('boolean');

    process.env.APP_LINK = 'https://max.ru/test_bot';
    process.env.USER_HASH_SECRET ??= 'test-secret';
    const res = await call('GET', `/api/dispatcher/executors/${first.id}/invite`, DISPATCHER);
    expect(res.statusCode).toBe(200);
    const url: string = res.json().url;
    expect(url).toMatch(/^https:\/\/max\.ru\/test_bot\?start=inv_/);
    // бот примет эту ссылку: подпись сходится и указывает на того же исполнителя
    expect(verifyInvite(url.split('start=')[1] ?? '', process.env.USER_HASH_SECRET)).toBe(first.id);

    // житель без роли диспетчера ссылку не получит
    const denied = await call('GET', `/api/dispatcher/executors/${first.id}/invite`, RESIDENT);
    expect(denied.statusCode).not.toBe(200);

    // несуществующий или чужой исполнитель — 404
    const missing = await call('GET', '/api/dispatcher/executors/nope/invite', DISPATCHER);
    expect(missing.statusCode).toBe(404);
  });

  it('назначение исполнителя меняет все заявки кластера сразу', async () => {
    await createAccepted(RESIDENT);
    await createAccepted(NEIGHBOUR);
    const before = await inbox();
    const card = before.clusters[0];
    expect(card?.requestIds).toHaveLength(2);

    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    const res = await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: card?.requestIds,
      executorId: executors[0].id,
      plannedAt: '2026-11-10T11:00:00.000Z',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().updated).toBe(2);

    const after = await inbox();
    expect(after.clusters[0]?.status).toBe('assigned');
    expect(after.clusters[0]?.executor?.nameShort).toBe(executors[0].nameShort);
  });

  it('житель видит в карточке, кто придёт и когда', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
      plannedAt: '2026-11-10T11:00:00.000Z',
    });

    const res = await call('GET', `/api/requests/${created.id}`, RESIDENT);
    const detail = RequestDetailSchema.parse(res.json());
    expect(detail.executor?.nameShort).toBe(executors[0].nameShort);
    // 11:00 UTC — это 14:00 по Казани, время показывается местное.
    expect(detail.executor?.slot).toContain('14:00');
    // Личный номер работника жителю не отдаём.
    expect(detail.executor?.phone).toBeNull();
  });

  it('без назначения исполнителя в карточке нет', async () => {
    const created = await createRequest(RESIDENT);
    expect(created.executor).toBeNull();
  });

  it('жителю уходит уведомление о назначении', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
    });

    const rows = await db.execute(sql`select payload from outbox`);
    const payloads = rows.rows.map((r) => r.payload as { type: string });
    expect(payloads.some((p) => p.type === 'assigned')).toBe(true);
  });

  it('привязанному исполнителю уходит наряд с адресом', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();

    // Исполнителя связывает с аккаунтом MAX приглашение; здесь привязку делаем напрямую.
    const [someone] = await db.execute(sql`select id from users limit 1`).then((r) => r.rows);
    await db.execute(
      sql`update executors set user_id = ${someone?.id as string} where id = ${executors[0].id}`,
    );

    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
      plannedAt: '2026-11-10T11:00:00.000Z',
    });

    const rows = await db.execute(sql`select payload from outbox`);
    const order = rows.rows
      .map((r) => r.payload as { type: string; address?: string; description?: string })
      .find((p) => p.type === 'order');
    expect(order?.address).toContain('Садовая');
    expect(order?.description).toBeTruthy();
  });

  it('без привязки исполнителя к аккаунту наряд не отправляется, но заявка назначена', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();

    const res = await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
    });
    expect(res.json().updated).toBe(1);

    const rows = await db.execute(sql`select payload from outbox`);
    const types = rows.rows.map((r) => (r.payload as { type: string }).type);
    expect(types).toContain('assigned');
    expect(types).not.toContain('order');
  });

  it('заявка чужой организации в массовом действии пропускается', async () => {
    const created = await createRequest(RESIDENT);
    // Дом переходит под управление другой организации: её диспетчер к нему отношения не имеет.
    await db.execute(
      sql`insert into organizations (id, type, name, region_code, data_kind)
          values ('org-test-other', 'uk', 'УК «Соседняя»', '16', 'model')
          on conflict (id) do nothing`,
    );
    await db.execute(sql`update houses set org_id = 'org-test-other' where id = ${HOUSE}`);

    const res = await call('POST', '/api/dispatcher/accept', DISPATCHER, {
      requestIds: [created.id],
    });
    expect(res.json().updated).toBe(0);
    expect(res.json().skipped[0].reason).toContain('другой организации');

    await db.execute(sql`update houses set org_id = 'org-16-uyut' where id = ${HOUSE}`);
  });

  it('недопустимый переход не валит остальные заявки', async () => {
    const ok = await createAccepted(RESIDENT);
    const other = await createAccepted(NEIGHBOUR);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();

    // Одну заявку доводим до выполненной — назначить исполнителя на неё уже нельзя.
    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [other.id],
      executorId: executors[0].id,
    });
    await call('POST', '/api/dispatcher/complete', DISPATCHER, { requestIds: [other.id] });

    const res = await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [ok.id, other.id],
      executorId: executors[0].id,
    });
    expect(res.json().updated).toBe(1);
    expect(res.json().skipped).toHaveLength(1);
  });

  it('выполненная работа уходит из кабинета после подтверждения жителем', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();

    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
    });
    await call('POST', '/api/dispatcher/complete', DISPATCHER, { requestIds: [created.id] });

    const still = await inbox();
    expect(still.clusters).toHaveLength(1);
    expect(still.clusters[0]?.status).toBe('done');

    await call('POST', `/api/requests/${created.id}/confirm`, RESIDENT, { accepted: true });
    const after = await inbox();
    expect(after.clusters).toHaveLength(0);
    expect(after.totalKopecks).toBe(0);
  });

  it('отказ жителя возвращает кластер в кабинет', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
    });
    await call('POST', '/api/dispatcher/complete', DISPATCHER, { requestIds: [created.id] });
    await call('POST', `/api/requests/${created.id}/confirm`, RESIDENT, { accepted: false });

    const after = await inbox();
    expect(after.clusters).toHaveLength(1);
    expect(after.clusters[0]?.status).toBe('reopened');
    expect(after.clusters[0]?.overdue).toBe(false);
  });

  it('нельзя прикрепить фото, загруженное другим человеком и ещё не привязанное к заявке', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
    });

    // RESIDENT загрузил фото для своей будущей заявки — оно ещё ни к чему не привязано.
    const strangersPhoto = await uploadPhoto(RESIDENT);

    const res = await call('POST', '/api/dispatcher/complete', DISPATCHER, {
      requestIds: [created.id],
      photoKeys: [strangersPhoto],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().updated).toBe(1);

    // Заявка закрылась, но чужое фото угнать по ключу не удалось.
    const row = await db
      .select({ requestId: photos.requestId, stage: photos.stage })
      .from(photos)
      .where(eq(photos.storageKey, strangersPhoto));
    expect(row[0]?.requestId).toBeNull();
    expect(row[0]?.stage).toBe('before');
  });

  it('своё фото диспетчер прикрепляет как обычно', async () => {
    const created = await createAccepted(RESIDENT);
    const executors = (await call('GET', '/api/dispatcher/executors', DISPATCHER)).json();
    await call('POST', '/api/dispatcher/assign', DISPATCHER, {
      requestIds: [created.id],
      executorId: executors[0].id,
    });

    const ownPhoto = await uploadPhoto(DISPATCHER);
    await call('POST', '/api/dispatcher/complete', DISPATCHER, {
      requestIds: [created.id],
      photoKeys: [ownPhoto],
    });

    const row = await db
      .select({ requestId: photos.requestId, stage: photos.stage })
      .from(photos)
      .where(eq(photos.storageKey, ownPhoto));
    expect(row[0]?.requestId).toBe(created.id);
    expect(row[0]?.stage).toBe('after');
  });

  it('отклонение требует причины', async () => {
    const created = await createRequest(RESIDENT);
    const bad = await call('POST', '/api/dispatcher/reject', DISPATCHER, {
      requestIds: [created.id],
    });
    expect(bad.statusCode).toBe(400);

    const good = await call('POST', '/api/dispatcher/reject', DISPATCHER, {
      requestIds: [created.id],
      reason: 'Заявка дублирует ранее поданную',
    });
    expect(good.json().updated).toBe(1);

    const after = await inbox();
    expect(after.clusters).toHaveLength(0);
  });
});
