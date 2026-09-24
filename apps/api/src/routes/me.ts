import { consents, type Db, eq, houses, memberships } from '@msc/db';
import type { Me } from '@msc/domain';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { type AuthContext, getAuth } from '../auth/authenticate';

export const meRoutes =
  (db: Db, authenticate: preHandlerAsyncHookHandler): FastifyPluginAsync =>
  async (app) => {
    // Кто я: профиль MAX, роли и привязанный дом. Первый вызов создаёт пользователя в БД.
    app.get('/api/me', { preHandler: authenticate }, async (req) => buildMe(db, getAuth(req)));
  };

/** Собирает ответ /api/me. Используется и после привязки к дому, чтобы клиент получил тот же объект. */
export async function buildMe(db: Db, auth: AuthContext): Promise<Me> {
  const { userId, maxUser, startParam } = auth;

  const rows = await db
    .select({
      role: memberships.role,
      houseId: memberships.houseId,
      orgId: memberships.orgId,
      apartmentLabel: memberships.apartmentLabel,
      confirmed: memberships.confirmed,
      address: houses.address,
    })
    .from(memberships)
    .leftJoin(houses, eq(memberships.houseId, houses.id))
    .where(eq(memberships.userId, userId));

  const [consent] = await db
    .select({ id: consents.id })
    .from(consents)
    .where(eq(consents.userId, userId))
    .limit(1);

  // главная роль: сотрудник УК важнее жителя; нет привязок — null (нужна первая привязка)
  const staff = rows.find((r) => r.role === 'dispatcher' || r.role === 'executor');
  const resident = rows.find((r) => r.role === 'resident');
  const home = resident?.houseId ? { id: resident.houseId, address: resident.address ?? '' } : null;

  return {
    user: {
      id: userId,
      firstName: maxUser.first_name,
      lastName: maxUser.last_name ?? null,
      username: maxUser.username ?? null,
      photoUrl: maxUser.photo_url ?? null,
    },
    role: staff?.role ?? resident?.role ?? null,
    house: home,
    apartmentLabel: resident?.apartmentLabel ?? null,
    consentGiven: Boolean(consent),
    memberships: rows.map((r) => ({
      role: r.role,
      houseId: r.houseId,
      orgId: r.orgId,
      apartmentLabel: r.apartmentLabel,
      confirmed: r.confirmed,
    })),
    startParam: startParam ?? null,
  };
}
