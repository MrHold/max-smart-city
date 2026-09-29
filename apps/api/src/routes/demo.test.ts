import { randomBytes } from 'node:crypto';
import { createDb, eq, parseEncKey, requests, runMigrations, sql } from '@msc/db';
import { DemoClockStateSchema, RequestDetailSchema } from '@msc/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { signInitData } from '../auth/init-data';
import { createDemoClock } from '../clock/demo';
import { loadRegionsData, regionsDataSource } from '../data/regions';
import { seedFromRegions } from '../data/seed';
import { linkTtlMs } from './doc-link';

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
// Заявка подана только что: срок ещё не истёк, суммы нет.
const REAL_NOW = new Date('2026-11-10T09:30:00Z');

const RESIDENT = signInitData(
  {
    auth_date: String(Math.floor(REAL_NOW.getTime() / 1000)),
    query_id: 'demo-clock',
    user: JSON.stringify({ id: 7001, first_name: 'Житель', language_code: 'ru' }),
  },
  BOT_TOKEN,
);

const HOUR = 3_600_000;

suite('демо-часы', () => {
  const { db, pool } = createDb(url as string);
  const clock = createDemoClock(db, { now: () => REAL_NOW }, 60_000);
  let app: ReturnType<typeof buildApp>;
  let shifts = 0;
  let regions: Awaited<ReturnType<typeof loadRegionsData>>;

  const call = (method: 'GET' | 'POST', path: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { 'x-init-data': RESIDENT },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const createRequest = async () => {
    const res = await call('POST', '/api/requests', {
      category: 'heating',
      location: { scope: 'apartment' },
      description: 'Батареи холодные',
      startedAt: clock.now().toISOString(),
      measurements: [
        { value: 15, unit: 'celsius', measuredAt: clock.now().toISOString(), place: 'room' },
      ],
      plannedNotice: null,
      photoKeys: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    return RequestDetailSchema.parse(res.json());
  };

  const detail = async (id: string) => {
    const res = await call('GET', `/api/requests/${id}`);
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
      clock,
      afterClockShift: async () => {
        shifts += 1;
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate table requests, joins, measurements, request_events, outbox, memberships, users, demo_clock restart identity cascade`,
    );
    await seedFromRegions(db, regions);
    await clock.set(0);
    await call('POST', '/api/me/house', { houseId: HOUSE, apartmentLabel: 'кв. 12' });
  });

  it('по умолчанию идут как настоящие', async () => {
    const state = DemoClockStateSchema.parse((await call('GET', '/api/demo/clock')).json());
    expect(state.offsetMs).toBe(0);
    expect(state.label).toBe('реальное время');
    expect(state.now).toBe(REAL_NOW.toISOString());
  });

  it('сдвигаются на указанное число часов', async () => {
    const state = DemoClockStateSchema.parse(
      (await call('POST', '/api/demo/clock', { shiftHours: 6 })).json(),
    );
    expect(state.offsetMs).toBe(6 * HOUR);
    expect(state.label).toBe('+6 ч');
    expect(new Date(state.now).getTime()).toBe(REAL_NOW.getTime() + 6 * HOUR);
  });

  it('сдвиги складываются, сброс возвращает настоящее время', async () => {
    await call('POST', '/api/demo/clock', { shiftHours: 2 });
    const twice = (await call('POST', '/api/demo/clock', { shiftHours: 3 })).json();
    expect(twice.offsetMs).toBe(5 * HOUR);

    const reset = (await call('POST', '/api/demo/clock', { reset: true })).json();
    expect(reset.offsetMs).toBe(0);
    expect(reset.now).toBe(REAL_NOW.toISOString());
  });

  it('сдвиг переживает перезапуск: он лежит в базе, а не в памяти', async () => {
    await call('POST', '/api/demo/clock', { shiftHours: 8 });
    const fresh = createDemoClock(db, { now: () => REAL_NOW }, 60_000);
    expect(await fresh.refresh()).toBe(8 * HOUR);
    fresh.stop();
  });

  it('перемотка делает заявку просроченной', async () => {
    const created = await createRequest();
    expect(created.overdue).toBe(false);

    await call('POST', '/api/demo/clock', { shiftHours: 3 });
    expect((await detail(created.id)).overdue).toBe(true);
  });

  it('работу закрыли в срок — заявка не становится просроченной, пока ждёт подтверждения', async () => {
    const created = await createRequest();
    // Исполнитель отметил «Выполнено» до истечения срока.
    await db
      .update(requests)
      .set({ status: 'done', endedAt: clock.now() })
      .where(eq(requests.id, created.id));

    // Перематываем далеко за dueAt: житель просто не успел подтвердить.
    await call('POST', '/api/demo/clock', { shiftHours: 10 });
    const after = await detail(created.id);

    expect(after.overdue).toBe(false);
    expect(after.gji.available).toBe(false);
  });

  it('перемотка открывает шаг в ГЖИ', async () => {
    const created = await createRequest();
    expect(created.gji.available).toBe(false);
    expect(created.gji.afterAt).toBe(created.dueAt);

    await call('POST', '/api/demo/clock', { shiftHours: 3 });
    expect((await detail(created.id)).gji.available).toBe(true);
  });

  it('сумма перерасчёта растёт вместе со временем', async () => {
    const created = await createRequest();
    expect(created.liability?.apartmentKopecks ?? 0).toBe(0);

    await call('POST', '/api/demo/clock', { shiftHours: 4 });
    const after4 = await detail(created.id);
    await call('POST', '/api/demo/clock', { shiftHours: 4 });
    const after8 = await detail(created.id);

    expect(after4.liability?.apartmentKopecks ?? 0).toBeGreaterThan(0);
    expect(after8.liability?.apartmentKopecks ?? 0).toBeGreaterThan(
      after4.liability?.apartmentKopecks ?? 0,
    );
  });

  it('документы появляются по мере появления оснований', async () => {
    const created = await createRequest();

    // Пока суммы нет, требовать нечего.
    const early = await call('GET', `/api/requests/${created.id}/documents/claim.pdf`);
    expect(early.statusCode).toBe(409);
    // Жалобу в инспекцию до истечения срока ответа возвращают как преждевременную.
    const earlyGji = await call('GET', `/api/requests/${created.id}/documents/gji.pdf`);
    expect(earlyGji.statusCode).toBe(409);

    await call('POST', '/api/demo/clock', { shiftHours: 6 });

    const claim = await call('GET', `/api/requests/${created.id}/documents/claim.pdf`);
    expect(claim.statusCode, claim.body.slice(0, 200)).toBe(200);
    expect(claim.headers['content-type']).toContain('application/pdf');
    expect(claim.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const gji = await call('GET', `/api/requests/${created.id}/documents/gji.pdf`);
    expect(gji.statusCode).toBe(200);
    expect(gji.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('документ открывается по временной ссылке без заголовка входа', async () => {
    const created = await createRequest();
    await call('POST', '/api/demo/clock', { shiftHours: 6 });

    // Кнопка в мини-приложении открывает адрес обычным переходом: заголовков нет.
    const naked = await app.inject({
      method: 'GET',
      url: `/api/requests/${created.id}/documents/claim.pdf`,
    });
    expect(naked.statusCode).toBe(401);

    const link = await call('POST', `/api/requests/${created.id}/documents/claim/link`);
    expect(link.statusCode, link.body).toBe(200);
    const { url, expiresAt } = link.json();
    expect(url).toContain('sig=');
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    const pdf = await app.inject({ method: 'GET', url });
    expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('ссылка на документ приходит сразу в карточке', async () => {
    const created = await createRequest();
    await call('POST', '/api/demo/clock', { shiftHours: 6 });

    const detail = RequestDetailSchema.parse(
      (await call('GET', `/api/requests/${created.id}`)).json(),
    );
    expect(detail.claim.available).toBe(true);
    expect(detail.claim.url).toContain('sig=');

    const pdf = await app.inject({ method: 'GET', url: detail.claim.url as string });
    expect(pdf.statusCode).toBe(200);
  });

  it('подделанная и просроченная ссылки не работают', async () => {
    const created = await createRequest();
    await call('POST', '/api/demo/clock', { shiftHours: 6 });
    const { url } = (await call('POST', `/api/requests/${created.id}/documents/claim/link`)).json();

    const spoiled = url.replace(/sig=[^&]+/, 'sig=подделка');
    expect((await app.inject({ method: 'GET', url: spoiled })).statusCode).toBe(403);

    // Демо-часы двигают сроки заявки, но не жизнь ссылки: она идёт по настоящему времени
    await call('POST', '/api/demo/clock', { shiftHours: 24 });
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + linkTtlMs + 60_000);
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(403);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ссылку на жалобу не выдают раньше срока', async () => {
    const created = await createRequest();
    const early = await call('POST', `/api/requests/${created.id}/documents/gji/link`);
    expect(early.statusCode).toBe(409);

    await call('POST', '/api/demo/clock', { shiftHours: 6 });
    const later = await call('POST', `/api/requests/${created.id}/documents/gji/link`);
    expect(later.statusCode).toBe(200);
  });

  it('чужие документы не отдаются', async () => {
    const created = await createRequest();
    await call('POST', '/api/demo/clock', { shiftHours: 6 });

    const stranger = signInitData(
      {
        auth_date: String(Math.floor(REAL_NOW.getTime() / 1000)),
        query_id: 'demo-stranger',
        user: JSON.stringify({ id: 7009, first_name: 'Чужой', language_code: 'ru' }),
      },
      BOT_TOKEN,
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/requests/${created.id}/documents/claim.pdf`,
      headers: { 'x-init-data': stranger },
    });
    expect(res.statusCode).toBe(403);
  });

  it('после перемотки сразу запускается автозакрытие', async () => {
    const before = shifts;
    await call('POST', '/api/demo/clock', { shiftHours: 1 });
    expect(shifts).toBe(before + 1);
    // Обычное чтение времени проверку не запускает.
    await call('GET', '/api/demo/clock');
    expect(shifts).toBe(before + 1);
  });

  it('сброс демо-часов назад не возвращает заявку из будущего как дубль', async () => {
    // Заявка создана «в будущем» относительно текущего момента (после перемотки вперёд).
    await call('POST', '/api/demo/clock', { shiftHours: 5 });
    const future = await createRequest();

    // Часы сброшены к настоящему: с этой точки зрения future.createdAt ещё не наступил.
    await call('POST', '/api/demo/clock', { reset: true });
    const created = await createRequest();

    expect(created.id).not.toBe(future.id);
  });

  it('вне демо-режима маршрутов нет', async () => {
    process.env.DEMO_MODE = '0';
    expect((await call('GET', '/api/demo/clock')).statusCode).toBe(404);
    expect((await call('POST', '/api/demo/clock', { shiftHours: 1 })).statusCode).toBe(404);
    process.env.DEMO_MODE = '1';
  });

  it('не принимает бессмысленный сдвиг', async () => {
    expect((await call('POST', '/api/demo/clock', { shiftHours: 10_000 })).statusCode).toBe(400);
    expect((await call('POST', '/api/demo/clock', {})).statusCode).toBe(400);
  });
});
