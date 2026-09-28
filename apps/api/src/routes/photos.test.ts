import multipart from '@fastify/multipart';
import Fastify, { type preHandlerAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import type { Storage } from '../storage';
import { photosRoutes } from './photos';

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

// Заглушка входа: подпись initData проверяется в auth.test.ts, здесь важно
// только одно — без заголовка маршрут загрузки не пускает.
const fakeAuthenticate: preHandlerAsyncHookHandler = async (req, reply) => {
  if (!req.headers['x-init-data']) {
    return reply.status(401).send({ error: { code: 'unauthorized', message: 'Нужен вход' } });
  }
};

const app = Fastify();
app.register(multipart);
app.setErrorHandler((err: unknown, _req, reply) => {
  if (err instanceof ApiError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
  }
  return reply.status(500).send({ error: { code: 'internal', message: String(err) } });
});
app.register(photosRoutes(memoryStorage, fakeAuthenticate));

beforeAll(() => app.ready());
afterAll(() => app.close());

const boundary = 'x-boundary';
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const pngBody = Buffer.concat([
  Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
  ),
  png,
  Buffer.from(`\r\n--${boundary}--\r\n`),
]);
const multipartHeader = { 'content-type': `multipart/form-data; boundary=${boundary}` };

describe('фото', () => {
  it('без входа загрузить нельзя — 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/photos',
      headers: multipartHeader,
      payload: pngBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it('с входом фото загружается и отдаётся обратно', async () => {
    const up = await app.inject({
      method: 'POST',
      url: '/api/photos',
      headers: { ...multipartHeader, 'x-init-data': 'test' },
      payload: pngBody,
    });
    expect(up.statusCode).toBe(200);
    const { key, url } = up.json() as { key: string; url: string };
    expect(url).toBe(`/api/photos/${key}`);

    // Скачивание открыто без входа — как у <img src> в мини-приложении
    const down = await app.inject({ url });
    expect(down.statusCode).toBe(200);
    expect(down.headers['content-type']).toContain('image/png');
    expect(down.rawPayload.equals(png)).toBe(true);
  });

  it('не картинка — 400', async () => {
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhi\r\n--${boundary}--\r\n`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/photos',
      headers: { ...multipartHeader, 'x-init-data': 'test' },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it('неизвестный ключ — 404', async () => {
    const res = await app.inject({ url: `/api/photos/bb/${'b'.repeat(40)}.jpg` });
    expect(res.statusCode).toBe(404);
  });
});
