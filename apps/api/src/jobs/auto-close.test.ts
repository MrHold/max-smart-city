import { randomBytes } from 'node:crypto';
import { createDb, eq, parseEncKey, requestEvents, requests, runMigrations, sql } from '@msc/db';
import { RequestDetailSchema } from '@msc/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { signInitData } from '../auth/init-data';
import { loadRegionsData, regionsDataSource } from '../data/regions';
import { seedFromRegions } from '../data/seed';
import { closeStaleRequests } from './auto-close';

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const BOT_TOKEN = 'test-token';
const auth: AuthConfig = {
  botToken: BOT_TOKEN,
  hashSecret: 'test-hash-secret',
  encKey: parseEncKey(randomBytes(32).toString('base64')),
  // Часы в тесте прыгают на десятки суток, поэтому окно свежести входа делаем широким:
  // проверяется автозакрытие, а не срок жизни подписи.
  maxAgeSec: 60 * 86_400,
};

const HOUSE = 'house-16-kazan-001';
const DONE_AT = new Date('2026-11-10T12:00:00Z');
const DAY = 86_400_000;

// Часы подвижные: тест сам решает, сколько времени прошло после выполнения работы.
let current = new Date(DONE_AT);
const clock = { now: () => current };

const RESIDENT = signInitData(
  {
    auth_date: String(Math.floor((DONE_AT.getTime() - 7 * 3_600_000) / 1000)),
    query_id: 'auto-close',
    user: JSON.stringify({ id: 5001, first_name: 'Житель', language_code: 'ru' }),
  },
  BOT_TOKEN,
);

suite('автозакрытие', () => {
  const { db, pool } = createDb(url as string);
  let app: ReturnType<typeof buildApp>;
  let regions: Awaited<ReturnType<typeof loadRegionsData>>;

  const call = (method: 'GET' | 'POST', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { 'x-init-data': RESIDENT },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** Создаёт заявку и доводит её до «выполнена» в момент DONE_AT. */
  const doneRequest = async (category = 'heating') => {
    current = new Date(DONE_AT.getTime() - 6 * 3_600_000);
    const started = current.toISOString();
    const res = await call('POST', '/api/requests', {
      category,
      location: { scope: 'apartment' },
      description: 'Батареи холодные',
      startedAt: started,
      measurements: [{ value: 15, unit: 'celsius', measuredAt: started, place: 'room' }],
      plannedNotice: null,
      photoKeys: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    const created = RequestDetailSchema.parse(res.json());

    await db
      .update(requests)
      .set({ status: 'done', endedAt: DONE_AT })
      .where(eq(requests.id, created.id));
    current = new Date(DONE_AT);
    return created;
  };

  const statusOf = async (id: string) =>
    (await db.select({ s: requests.status }).from(requests).where(eq(requests.id, id)))[0]?.s;

  beforeAll(async () => {
    process.env.DEMO_MODE = '1';
    await runMigrations(url as string);
    regions = await loadRegionsData();
    await seedFromRegions(db, regions);
    app = buildApp({ data: regionsDataSource(regions), regions, db, auth, clock });
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
    await seedFromRegions(db, regions);
    current = new Date(DONE_AT);
    await call('POST', '/api/me/house', { houseId: HOUSE, apartmentLabel: 'кв. 12' });
  });

  it('до трёх суток заявка остаётся выполненной', async () => {
    const created = await doneRequest();
    current = new Date(DONE_AT.getTime() + 2 * DAY);

    const result = await closeStaleRequests(db, clock);
    expect(result.closed).toBe(0);
    expect(await statusOf(created.id)).toBe('done');
  });

  it('через трое суток закрывается сама', async () => {
    const created = await doneRequest();
    current = new Date(DONE_AT.getTime() + 3 * DAY);

    const result = await closeStaleRequests(db, clock);
    expect(result.closed).toBe(1);
    expect(await statusOf(created.id)).toBe('confirmed');
  });

  it('в истории видно, что закрыта автоматически', async () => {
    const created = await doneRequest();
    current = new Date(DONE_AT.getTime() + 4 * DAY);
    await closeStaleRequests(db, clock);

    const events = await db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, created.id));
    const auto = events.find((e) => e.type === 'confirmed');
    expect(auto?.actorUserId).toBeNull();
    expect((auto?.payload as { auto?: boolean } | undefined)?.auto).toBe(true);

    const detail = RequestDetailSchema.parse(
      (await call('GET', `/api/requests/${created.id}`)).json(),
    );
    expect(detail.status).toBe('confirmed');
    const last = detail.events.at(-1);
    expect(last?.label).toContain('автоматически');
    expect(detail.overdue).toBe(false);
    expect(detail.gji.available).toBe(false);
  });

  it('жителю уходит уведомление', async () => {
    await doneRequest();
    current = new Date(DONE_AT.getTime() + 3 * DAY);
    await closeStaleRequests(db, clock);

    const rows = await db.execute(sql`select payload from outbox`);
    const types = rows.rows.map((r) => (r.payload as { type: string }).type);
    expect(types).toContain('auto_closed');
  });

  it('повторный запуск заявку заново не закрывает', async () => {
    await doneRequest();
    current = new Date(DONE_AT.getTime() + 3 * DAY);

    expect((await closeStaleRequests(db, clock)).closed).toBe(1);
    expect((await closeStaleRequests(db, clock)).closed).toBe(0);

    const rows = await db.execute(sql`select count(*)::int as n from outbox`);
    expect((rows.rows[0] as { n: number }).n).toBe(1);
  });

  it('подтверждённая жителем заявка не затрагивается', async () => {
    const created = await doneRequest();
    const res = await call('POST', `/api/requests/${created.id}/confirm`, { accepted: true });
    expect(res.statusCode, res.body).toBe(200);

    current = new Date(DONE_AT.getTime() + 10 * DAY);
    expect((await closeStaleRequests(db, clock)).closed).toBe(0);

    // Событие подтверждения одно и принадлежит человеку, а не системе.
    const events = await db
      .select()
      .from(requestEvents)
      .where(eq(requestEvents.requestId, created.id));
    const confirmed = events.filter((e) => e.type === 'confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.actorUserId).not.toBeNull();
  });

  it('возвращённая в работу заявка не закрывается', async () => {
    const created = await doneRequest();
    await call('POST', `/api/requests/${created.id}/confirm`, { accepted: false });

    current = new Date(DONE_AT.getTime() + 10 * DAY);
    expect((await closeStaleRequests(db, clock)).closed).toBe(0);
    expect(await statusOf(created.id)).toBe('reopened');
  });

  it('невыполненные заявки не закрываются, сколько бы ни прошло времени', async () => {
    const created = await doneRequest();
    await db
      .update(requests)
      .set({ status: 'assigned', endedAt: null })
      .where(eq(requests.id, created.id));

    current = new Date(DONE_AT.getTime() + 30 * DAY);
    expect((await closeStaleRequests(db, clock)).closed).toBe(0);
  });

  it('закрывает только просроченные из нескольких', async () => {
    const old = await doneRequest('heating');
    const fresh = await doneRequest('hot_water');
    // Вторая выполнена позже первой на два дня.
    await db
      .update(requests)
      .set({ endedAt: new Date(DONE_AT.getTime() + 2 * DAY) })
      .where(eq(requests.id, fresh.id));

    current = new Date(DONE_AT.getTime() + 3 * DAY);
    const result = await closeStaleRequests(db, clock);

    expect(result.closed).toBe(1);
    expect(await statusOf(old.id)).toBe('confirmed');
    expect(await statusOf(fresh.id)).toBe('done');
  });
});
