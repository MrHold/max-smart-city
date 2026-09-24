import { contacts, type Db, eq, houses, organizations } from '@msc/db';
import type { RegionsData } from './regions';

const dbKind = (k: 'official' | 'model') =>
  (k === 'official' ? 'real' : 'model') as 'real' | 'model';

/**
 * Переносит дома, управляющие организации и контакты из regions/*.yaml в БД.
 * Идемпотентно: повторный запуск обновляет строки, а не дублирует. Запускается при старте API.
 */
export async function seedFromRegions(db: Db, data: RegionsData) {
  let orgCount = 0;
  let houseCount = 0;

  await db.transaction(async (tx) => {
    for (const r of data.regions) {
      for (const o of r.orgs) {
        if (o.type !== 'uk' && o.type !== 'tsj' && o.type !== 'contractor') continue;
        const row = {
          type: o.type === 'contractor' ? ('contractor' as const) : ('uk' as const),
          name: o.name,
          regionCode: r.meta.code,
          dataKind: dbKind(o.dataKind),
        };
        await tx
          .insert(organizations)
          .values({ id: o.id, inn: null, ...row })
          .onConflictDoUpdate({ target: organizations.id, set: row });
        orgCount++;
      }

      for (const h of r.houses) {
        const row = {
          fiasId: h.fiasId,
          address: h.address,
          regionCode: r.meta.code,
          tz: r.meta.timezone,
          orgId: h.orgId,
          dataKind: dbKind(h.dataKind),
        };
        await tx
          .insert(houses)
          .values({ id: h.id, ...row })
          .onConflictDoUpdate({ target: houses.id, set: row });

        await tx.delete(contacts).where(eq(contacts.houseId, h.id));
        const org = r.orgs.find((o) => o.id === h.orgId);
        if (org && org.contacts.length > 0) {
          await tx.insert(contacts).values(
            org.contacts.map((c) => ({
              houseId: h.id,
              kind: c.kind,
              phone: c.phone,
              schedule: c.schedule,
            })),
          );
        }
        houseCount++;
      }
    }
  });

  return { orgs: orgCount, houses: houseCount };
}
