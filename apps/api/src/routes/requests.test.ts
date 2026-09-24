import { randomBytes } from 'node:crypto';
import { createDb, eq, outbox, requests, runMigrations, sql } from '@msc/db';
import { RequestDetailSchema } from '@msc/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import { parseEncKey } from '../auth/identity';
import { signInitData } from '../auth/init-data';
import { loadRegionsData, regionsDataSource } from '../data/regions';
import { seedFromRegions } from '../data/seed';

/**
 * Тесты ходят в настоящую базу: заявка живёт в нескольких таблицах и транзакциях,
 * и ошибки вроде «чужой замер попал в чужой расчёт» на моках не видны.
 *
 * База берётся из TEST_DATABASE_URL, иначе тесты пропускаются — чтобы проверка
 * не падала у того, кто не поднимал Postgres.
 */
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const BOT_TOKEN = 'test-token';
const auth: AuthConfig = {
  botToken: BOT_TOKEN,
  hashSecret: 'test-hash-secret',
  encKey: parseEncKey(randomBytes(32).toString('base64')),
  maxAgeSec: 3600,
};

const initDataFor = (id: number, name: string) =>
  signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: `test-${id}`,
      user: JSON.stringify({ id, first_name: name, language_code: 'ru' }),
    },
    BOT_TOKEN,
  );

const AUTHOR = initDataFor(9001, 'Автор');
const NEIGHBOUR = initDataFor(9002, 'Сосед');
const STRANGER = initDataFor(9003, 'Житель другого дома');

const HOUSE = 'house-16-kazan-001';
const OTHER_HOUSE = 'house-16-kazan-002';

// Вторник, 12:30 по Казани. Заявка началась в 06:30 — шесть часов назад.
const NOW = new Date('2026-11-10T09:30:00Z');
const STARTED = '2026-11-10T03:30:00.000Z';

suite('заявки', () => {
  const { db, pool } = createDb(url as string);
  let app: ReturnType<typeof buildApp>;

  const call = (method: 'GET' | 'POST', path: string, initData: string, payload?: unknown) =>
    app.inject({
      method,
      url: path,
      headers: { 'x-init-data': initData },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const bind = (initData: string, houseId: string, apartmentLabel: string) =>
    call('POST', '/api/me/house', initData, { houseId, apartmentLabel });

  const newRequest = (over: Record<string, unknown> = {}) => ({
    category: 'heating',
    location: { scope: 'apartment' },
    description: 'Батареи еле тёплые',
    startedAt: STARTED,
    measurements: [{ value: 15, unit: 'celsius', measuredAt: STARTED, place: 'room' }],
    plannedNotice: null,
    photoKeys: [],
    ...over,
  });

  const createRequest = async () => {
    const res = await call('POST', '/api/requests', AUTHOR, newRequest());
    expect(res.statusCode, res.body).toBe(200);
    return RequestDetailSchema.parse(res.json());
  };

  beforeAll(async () => {
    await runMigrations(url as string);
    const regions = await loadRegionsData();
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
    await bind(AUTHOR, HOUSE, 'кв. 12');
    await bind(NEIGHBOUR, HOUSE, 'кв. 45');
    await bind(STRANGER, OTHER_HOUSE, 'кв. 7');
  });

  it('создаёт заявку со сроком из нормы и посчитанной суммой', async () => {
    const detail = await createRequest();

    expect(detail.number).toMatch(/^2026-\d{4}$/);
    expect(detail.title).toBe('Холодные батареи');
    // Срок аварийной категории — два часа от начала: 06:30 + 2 ч.
    expect(detail.dueAt).toBe('2026-11-10T05:30:00.000Z');
    expect(detail.overdue).toBe(true);
    // Шесть часов по три градуса: 0,15 % за градусо-час от платы за месяц.
    expect(detail.liability?.hours).toBe(6);
    expect(detail.liability?.apartmentKopecks).toBe(6496);
    expect(detail.liability?.rulesVersion).toBe('2026.09.1');
  });

  it('у каждого шага расчёта есть происхождение', async () => {
    const detail = await createRequest();
    for (const step of detail.liability?.steps ?? []) {
      expect(['fact', 'calc', 'model']).toContain(step.provenance);
    }
  });

  it('не принимает дату начала из будущего', async () => {
    const res = await call('POST', '/api/requests', AUTHOR, {
      ...newRequest(),
      startedAt: '2026-11-20T00:00:00.000Z',
    });
    expect(res.statusCode).toBe(400);
  });

  it('не принимает перерыв отопления без замера', async () => {
    const res = await call('POST', '/api/requests', AUTHOR, {
      ...newRequest({ category: 'heating_off', measurements: [] }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('температуру');
  });

  describe('«У меня тоже»', () => {
    const join =
      (initData: string, apartmentLabel = 'кв. 45', measurements: unknown[] = []) =>
      (id: string) =>
        call('POST', `/api/requests/${id}/join`, initData, { apartmentLabel, measurements });

    it('увеличивает оценку по дому, но не личную сумму автора', async () => {
      const created = await createRequest();
      const res = await join(NEIGHBOUR, 'кв. 45', [
        { value: 10, unit: 'celsius', measuredAt: STARTED, place: 'room' },
      ])(created.id);
      expect(res.statusCode, res.body).toBe(200);
      const detail = RequestDetailSchema.parse(res.json());

      expect(detail.joinersCount).toBe(1);
      expect(detail.joiners[0]?.apartmentLabel).toBe('кв. 45');
      // Замер соседа холоднее, но на перерасчёт автора он не влияет.
      expect(detail.liability?.apartmentKopecks).toBe(created.liability?.apartmentKopecks);
      expect(detail.liability?.houseKopecks).toBe((created.liability?.apartmentKopecks ?? 0) * 2);
    });

    it('ставит автору уведомление в очередь', async () => {
      const created = await createRequest();
      await join(NEIGHBOUR)(created.id);

      const rows = await db.select().from(outbox);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.payload).toMatchObject({ type: 'joined', apartmentLabel: 'кв. 45' });
    });

    it('не даёт присоединиться дважды', async () => {
      const created = await createRequest();
      await join(NEIGHBOUR)(created.id);
      const second = await join(NEIGHBOUR)(created.id);
      expect(second.statusCode).toBe(409);
    });

    it('не даёт присоединиться к своей заявке', async () => {
      const created = await createRequest();
      const res = await join(AUTHOR, 'кв. 12')(created.id);
      expect(res.statusCode).toBe(409);
    });

    it('не пускает жителя другого дома', async () => {
      const created = await createRequest();
      const res = await join(STRANGER, 'кв. 7')(created.id);
      expect(res.statusCode).toBe(403);
    });
  });

  describe('приёмка работы', () => {
    // Выполнение работы — зона диспетчера и исполнителя, их маршрутов ещё нет,
    // поэтому доводим заявку до «выполнена» напрямую в базе.
    const markDone = (id: string) =>
      db.update(requests).set({ status: 'done' }).where(eq(requests.id, id));

    it('подтвердить может только автор', async () => {
      const created = await createRequest();
      await markDone(created.id);
      const res = await call('POST', `/api/requests/${created.id}/confirm`, NEIGHBOUR, {
        accepted: true,
      });
      expect(res.statusCode).toBe(403);
    });

    it('до выполнения работы отвечает понятной ошибкой, а не пятисоткой', async () => {
      const created = await createRequest();
      const res = await call('POST', `/api/requests/${created.id}/confirm`, AUTHOR, {
        accepted: true,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toContain('не отмечена выполненной');
    });

    it('принятая работа закрывает заявку', async () => {
      const created = await createRequest();
      await markDone(created.id);
      const res = await call('POST', `/api/requests/${created.id}/confirm`, AUTHOR, {
        accepted: true,
      });
      const detail = RequestDetailSchema.parse(res.json());

      expect(detail.status).toBe('confirmed');
      expect(detail.endedAt).not.toBeNull();
      expect(detail.overdue).toBe(false);
      expect(detail.gji.available).toBe(false);
    });

    it('отказ возвращает заявку в работу и перезапускает срок', async () => {
      const created = await createRequest();
      await markDone(created.id);
      const res = await call('POST', `/api/requests/${created.id}/confirm`, AUTHOR, {
        accepted: false,
        note: 'Батареи так и не прогрелись',
      });
      const detail = RequestDetailSchema.parse(res.json());

      expect(detail.status).toBe('reopened');
      expect(detail.endedAt).toBeNull();
      // Новый срок отсчитывается от момента отказа, поэтому просрочки больше нет.
      expect(new Date(detail.dueAt).getTime()).toBeGreaterThan(NOW.getTime());
      expect(detail.overdue).toBe(false);
      expect(detail.events.map((e) => e.type)).toContain('reopened');
    });
  });

  describe('доступ и списки', () => {
    it('в списке видны свои заявки и те, к которым присоединился', async () => {
      const created = await createRequest();
      await call('POST', `/api/requests/${created.id}/join`, NEIGHBOUR, {
        apartmentLabel: 'кв. 45',
        measurements: [],
      });

      const mine = await call('GET', '/api/requests', AUTHOR);
      const theirs = await call('GET', '/api/requests', NEIGHBOUR);
      expect(mine.json()).toHaveLength(1);
      expect(theirs.json()).toHaveLength(1);
      expect(theirs.json()[0].joinersCount).toBe(1);
    });

    it('житель другого дома карточку не видит', async () => {
      const created = await createRequest();
      const res = await call('GET', `/api/requests/${created.id}`, STRANGER);
      expect(res.statusCode).toBe(403);
    });

    it('сосед видит карточку и может присоединиться', async () => {
      const created = await createRequest();
      const res = await call('GET', `/api/requests/${created.id}`, NEIGHBOUR);
      const detail = RequestDetailSchema.parse(res.json());
      expect(detail.isAuthor).toBe(false);
      expect(detail.canJoin).toBe(true);
    });

    it('без входа заявки не отдаются', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/requests' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('шаг в ГЖИ', () => {
    it('открывается только после истечения срока ответа', async () => {
      const created = await createRequest();
      expect(created.gji.available).toBe(true);
      expect(created.gji.afterAt).toBe(created.dueAt);

      // Та же заявка, но начавшаяся только что: срок ещё не истёк.
      const fresh = await call('POST', '/api/requests', AUTHOR, {
        ...newRequest({
          startedAt: NOW.toISOString(),
          measurements: [
            { value: 15, unit: 'celsius', measuredAt: NOW.toISOString(), place: 'room' },
          ],
        }),
      });
      const detail = RequestDetailSchema.parse(fresh.json());
      expect(detail.gji.available).toBe(false);
      expect(detail.gji.afterAt).toBe(detail.dueAt);
    });
  });
});
