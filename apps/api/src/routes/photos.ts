import type { FastifyPluginAsync } from 'fastify';
import { badRequest, notFound } from '../errors';
import { allowedImageTypes, maxPhotoBytes, type Storage } from '../storage';

export const photosRoutes =
  (storage: Storage): FastifyPluginAsync =>
  async (app) => {
    app.post('/api/photos', async (req) => {
      const file = await req.file({ limits: { fileSize: maxPhotoBytes, files: 1 } });
      if (!file) throw badRequest('Нужен файл в поле file');
      if (!allowedImageTypes[file.mimetype])
        throw badRequest('Только фото: JPEG, PNG, WebP или HEIC');
      const buffer = await file.toBuffer();
      if (file.file.truncated) throw badRequest('Фото больше 5 МБ');
      const { key } = await storage.put(buffer, file.mimetype);
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
