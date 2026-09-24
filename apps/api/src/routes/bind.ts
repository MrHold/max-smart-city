import { and, type Db, eq, houses, memberships } from '@msc/db';
import { BindHouseInputSchema } from '@msc/domain';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { getAuth } from '../auth/authenticate';
import { badRequest, notFound } from '../errors';
import { buildMe } from './me';

export const bindRoutes =
  (db: Db, authenticate: preHandlerAsyncHookHandler): FastifyPluginAsync =>
  async (app) => {
    // Привязка к дому: один раз при первом входе, потом можно сменить в профиле.
    app.post('/api/me/house', { preHandler: authenticate }, async (req) => {
      const auth = getAuth(req);
      const parsed = BindHouseInputSchema.safeParse(req.body);
      if (!parsed.success) {
        throw badRequest(parsed.error.issues[0]?.message ?? 'Укажите дом и квартиру');
      }
      const { houseId, apartmentLabel } = parsed.data;

      const [house] = await db
        .select({ id: houses.id })
        .from(houses)
        .where(eq(houses.id, houseId))
        .limit(1);
      if (!house) throw notFound('Дом');

      const [existing] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, auth.userId), eq(memberships.role, 'resident')))
        .limit(1);

      if (existing) {
        await db
          .update(memberships)
          .set({ houseId, apartmentLabel, confirmed: false })
          .where(eq(memberships.id, existing.id));
      } else {
        await db
          .insert(memberships)
          .values({ userId: auth.userId, role: 'resident', houseId, apartmentLabel });
      }

      return buildMe(db, auth);
    });
  };
