import { HomeSchema } from '@msc/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { loadRegionsData, regionsDataSource } from './data/regions';
import type { Storage } from './storage';

const files = new Map<string, { buffer: Buffer; mime: string }>();
const memoryStorage: Storage = {
  async put(buffer, mime) {
    const key = `aa/${'a'.repeat(40)}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    files.set(key, { buffer, mime });
    return { key };
  },
  async get(key) {
    return files.get(key) ?? null;
  },
};

// понедельник 10:30 по Казани
const clock = { now: () => new Date('2026-11-09T07:30:00Z') };
const data = regionsDataSource(await loadRegionsData());
// Сборка без базы и без проверки входа: только открытые маршруты
const app = buildApp({ data, storage: memoryStorage, clock });

beforeAll(() => app.ready());
afterAll(() => app.close());

describe('api', () => {
  it('health', async () => {
    const res = await app.inject({ url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('поиск дома требует 3 символа и ищет без учёта регистра', async () => {
    expect((await app.inject({ url: '/api/houses?q=са' })).statusCode).toBe(400);
    const res = await app.inject({ url: '/api/houses?q=САДОВ' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].address).toContain('Садовая');
  });

  it('home соответствует контракту и считает открытость по местному времени', async () => {
    const res = await app.inject({ url: '/api/houses/house-16-kazan-001/home' });
    expect(res.statusCode).toBe(200);
    const home = HomeSchema.parse(res.json());
    const dispatcher = home.contacts.find((c) => c.kind === 'dispatcher');
    expect(dispatcher?.open).toEqual({ isOpen: true, until: '20:00' });
    expect(home.contacts.find((c) => c.kind === 'emergency')?.open).toBeNull();
    expect(home.now).toBe('2026-11-09T07:30:00.000Z');
  });

  it('неизвестный дом — 404 в едином формате', async () => {
    const res = await app.inject({ url: '/api/houses/nope/home' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Дом не найден' } });
  });

  it('категории: у коммунальных есть service, у ремонтных — zone', async () => {
    const res = await app.inject({ url: '/api/houses/house-16-kazan-001/categories' });
    const cats = res.json() as Array<{ kind: string; service?: string; zone?: string }>;
    for (const c of cats) {
      if (c.kind.startsWith('utility')) expect(c.service).toBeDefined();
      else expect(c.zone).toBeDefined();
    }
  });

  // S15: без проверки входа маршрут загрузки не создаётся вовсе.
  // Загрузка с входом проверяется в routes/photos.test.ts.
  it('без входа маршрута загрузки фото нет', async () => {
    const boundary = 'x-boundary';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/photos',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(res.statusCode).toBe(404);
  });

  it('скачивание фото по ключу открыто и без входа', async () => {
    // Кладём файл прямо в хранилище — загрузка в этой сборке недоступна
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const { key } = await memoryStorage.put(png, 'image/png');
    const res = await app.inject({ url: `/api/photos/${key}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.equals(png)).toBe(true);
  });
});
