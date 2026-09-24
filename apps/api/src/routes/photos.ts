import { createHash } from 'node:crypto';
import { type Db, photos } from '@msc/db';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { badRequest, notFound } from '../errors';
import { allowedImageTypes, maxPhotoBytes, type Storage } from '../storage';

export const photosRoutes =
  (storage: Storage, authenticate?: preHandlerAsyncHookHandler, db?: Db): FastifyPluginAsync =>
  async (app) => {
    // Загружать фото может только вошедший через MAX; отдача по ключу открыта — ключ неугадываемый
    app.post('/api/photos', { preHandler: authenticate ? [authenticate] : [] }, async (req) => {
      const file = await req.file({ limits: { fileSize: maxPhotoBytes, files: 1 } });
      if (!file) throw badRequest('Нужен файл в поле file');
      if (!allowedImageTypes[file.mimetype])
        throw badRequest('Только фото: JPEG, PNG, WebP или HEIC');
      const buffer = await file.toBuffer();
      if (file.file.truncated) throw badRequest('Фото больше 5 МБ');
      const { key } = await storage.put(buffer, file.mimetype);

      // Форма отправляется после загрузки, поэтому заявки ещё нет: фото ждёт её с requestId = null.
      // Без этой строки привязать фото к заявке потом не по чему, и карточка приходит пустой.
      if (db) {
        await db.insert(photos).values({
          storageKey: key,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          stage: 'before',
          uploadedBy: req.auth?.userId ?? null,
        });
      }

      return { key, url: `/api/photos/${key}` };
    });

    app.get('/api/photos/*', async (req, reply) => {
      const key = (req.params as { '*': string })['*'];
      const stored = await storage.get(key);
      if (!stored) throw notFound('Файл');
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      return reply.type(stored.mime).send(stored.buffer);
    });
  };
