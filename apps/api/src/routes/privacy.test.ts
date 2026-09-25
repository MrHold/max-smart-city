import { randomBytes } from 'node:crypto';
import { createDb, eq, parseEncKey, requests, runMigrations, sql, users } from '@msc/db';
import { MyDataSchema, RequestDetailSchema } from '@msc/domain';
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
const NOW = new Date('2026-11-10T09:30:00Z');
const STARTED = '2026-11-10T03:30:00.000Z';

const initDataFor = (id: number, name: string) =>
  signInitData(
    {
      auth_date: String(Math.floor(NOW.getTime() / 1000)),
      query_id: `privacy-${id}`,
      user: JSON.stringify({ id, first_name: name, language_code: 'ru' }),
    },
    BOT_TOKEN,
  );

const AUTHOR = initDataFor(6001, 'Житель');
const NEIGHBOUR = initDataFor(6002, 'Сосед');

suite('права на свои данные', () => {
  const { db, pool } = createDb(url as string);
  let app: ReturnType<typeof buildApp>;
  let regions: Awaited<ReturnType<typeof loadRegionsData>>;

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    initData: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: path,
      headers: { 'x-init-data': initData },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const bind = (initData: string, apartmentLabel: string) =>
    call('POST', '/api/me/house', initData, { houseId: HOUSE, apartmentLabel });

  const createRequest = async (initData: string, category = 'heating') => {
    const res = await call('POST', '/api/requests', initData, {
      category,
      location: { scope: 'apartment' },
      description: 'Батареи холодные',
      startedAt: STARTED,
      measurements: [{ value: 15, unit: 'celsius', measuredAt: STARTED, place: 'room' }],
      plannedNotice: null,
      photoKeys: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    return RequestDetailSchema.parse(res.json());
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
      sql`truncate table requests, joins, measurements, request_events, outbox, memberships, users, consents restart identity cascade`,
    );
    await seedFromRegions(db, regions);
    await bind(AUTHOR, 'кв. 12');
    await bind(NEIGHBOUR, 'кв. 45');
  });

  it('показывает состав хранимых данных с объяснением, зачем они', async () => {
    await createRequest(AUTHOR);

    const res = await call('GET', '/api/me/data', AUTHOR);
    expect(res.statusCode, res.body).toBe(200);
    const data = MyDataSchema.parse(res.json());

    const byLabel = new Map(data.items.map((i) => [i.label, i]));
    expect(byLabel.get('Привязка к дому и квартире')?.count).toBe(1);
    expect(byLabel.get('Привязка к дому и квартире')?.values?.[0]).toContain('кв. 12');
    expect(byLabel.get('Ваши заявки')?.count).toBe(1);

    // У каждого пункта объяснено назначение — иначе список выглядит отпиской.
    for (const item of data.items) expect(item.purpose.length).toBeGreaterThan(10);
    expect(data.deletionNotice).toContain('заявки останутся');
  });

  it('в данных нет ни имени, ни идентификатора MAX в открытом виде', async () => {
    const res = await call('GET', '/api/me/data', AUTHOR);
    const raw = res.body;
    expect(raw).not.toContain('Житель');
    expect(raw).not.toContain('6001');
  });

  it('удаление стирает привязку, согласия и присоединения', async () => {
    const mine = await createRequest(AUTHOR);
    await call('POST', `/api/requests/${mine.id}/join`, NEIGHBOUR, {
      apartmentLabel: 'кв. 45',
      measurements: [],
    });

    const res = await call('DELETE', '/api/me', NEIGHBOUR);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().deleted.memberships).toBe(1);
    expect(res.json().deleted.joins).toBe(1);

    // Заявка соседа осталась у дома, но присоединение исчезло.
    const detail = await call('GET', `/api/requests/${mine.id}`, AUTHOR);
    expect(RequestDetailSchema.parse(detail.json()).joinersCount).toBe(0);
  });

  it('заявки не удаляются, а перестают быть связаны с человеком', async () => {
    const mine = await createRequest(AUTHOR);

    const res = await call('DELETE', '/api/me', AUTHOR);
    expect(res.json().anonymizedRequests).toBe(1);

    // Сама заявка в базе осталась: она нужна дому и управляющей организации.
    const rows = await db.select().from(requests).where(eq(requests.id, mine.id));
    expect(rows).toHaveLength(1);
  });

  it('после удаления тот же вход создаёт нового пользователя без данных', async () => {
    await createRequest(AUTHOR);
    const before = await call('GET', '/api/me/data', AUTHOR);
    const oldUserId = MyDataSchema.parse(before.json()).userId;

    await call('DELETE', '/api/me', AUTHOR);

    const after = await call('GET', '/api/me/data', AUTHOR);
    const data = MyDataSchema.parse(after.json());
    expect(data.userId).not.toBe(oldUserId);

    const byLabel = new Map(data.items.map((i) => [i.label, i]));
    expect(byLabel.get('Ваши заявки')?.count).toBe(0);
    expect(byLabel.get('Привязка к дому и квартире')?.count).toBe(0);

    // Старая строка пользователя больше никому не соответствует.
    const old = await db
      .select({ hash: users.userHash })
      .from(users)
      .where(eq(users.id, oldUserId));
    expect(old[0]?.hash.startsWith('deleted:')).toBe(true);
  });

  it('без входа данные не отдаются и не удаляются', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/me/data' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/me' })).statusCode).toBe(401);
  });
});
