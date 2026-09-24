import { type Clock, HomeSchema, isOpen } from '@msc/domain';
import type { FastifyPluginAsync } from 'fastify';
import * as z from 'zod';
import type { DataSource } from '../data/source';
import { badRequest, notFound } from '../errors';

const SearchQuery = z.object({ q: z.string().trim().min(3).max(100) });
const HouseParams = z.object({ id: z.string().min(1) });

export const housesRoutes =
  (data: DataSource, clock: Clock): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/houses', async (req) => {
      const parsed = SearchQuery.safeParse(req.query);
      if (!parsed.success) throw badRequest('Введите не меньше 3 символов адреса');
      return data.searchHouses(parsed.data.q);
    });

    app.get('/api/houses/:id/home', async (req) => {
      const { id } = HouseParams.parse(req.params);
      const house = await data.getHouse(id);
      if (!house) throw notFound('Дом');
      const org = await data.getOrg(house.orgId);
      const now = clock.now();

      return HomeSchema.parse({
        house: { id: house.id, address: house.address, tz: house.tz, dataKind: house.dataKind },
        org: org
          ? { id: org.id, name: org.name, address: org.address, dataKind: org.dataKind }
          : null,
        contacts: (org?.contacts ?? []).map((c) => ({
          kind: c.kind,
          phone: c.phone,
          schedule: c.schedule,
          open: c.kind === 'emergency' ? null : isOpen(c.schedule, house.tz, now),
        })),
        announcement: org?.announcement ?? null,
        now: now.toISOString(),
      });
    });

    app.get('/api/houses/:id/categories', async (req) => {
      const { id } = HouseParams.parse(req.params);
      const house = await data.getHouse(id);
      if (!house) throw notFound('Дом');
      return data.getCategories(house.regionCode);
    });
  };
