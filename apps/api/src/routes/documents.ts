import {
  and,
  asc,
  type Db,
  eq,
  houses,
  joins,
  measurements as measurementsTable,
  memberships,
  requests,
} from '@msc/db';
import { buildClaimPdf, buildGjiPdf } from '@msc/documents';
import type { Clock, Measurement, RequestStatus } from '@msc/domain';
import { escalation, isClosed } from '@msc/domain';
import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { getAuth } from '../auth/authenticate';
import type { RegionsData } from '../data/regions';
import { ApiError, notFound } from '../errors';
import { liabilityFor } from './liability-of';

const forbidden = (message: string) => new ApiError(403, 'forbidden', message);
const conflict = (message: string) => new ApiError(409, 'conflict', message);

const toMeasurement = (row: typeof measurementsTable.$inferSelect): Measurement => ({
  value: row.value,
  unit: 'celsius',
  measuredAt: row.measuredAt.toISOString(),
  place: row.place,
});

/**
 * Документы по заявке: заявление о перерасчёте и обращение в жилищную инспекцию.
 *
 * Оба доступны только автору заявки, и каждый — только когда для него есть основание:
 * заявление без посчитанной суммы бессмысленно, а жалобу в инспекцию до истечения
 * срока ответа управляющей организации возвращают как преждевременную.
 */
export const documentsRoutes =
  (
    db: Db,
    data: RegionsData,
    clock: Clock,
    authenticate: preHandlerAsyncHookHandler,
  ): FastifyPluginAsync =>
  async (app) => {
    async function context(requestId: string, userId: string) {
      const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
      if (!row) throw notFound('Заявка');
      if (row.authorUserId !== userId) throw forbidden('Документ доступен только автору заявки');

      const [house] = await db
        .select({
          address: houses.address,
          tz: houses.tz,
          regionCode: houses.regionCode,
          orgId: houses.orgId,
        })
        .from(houses)
        .where(eq(houses.id, row.houseId))
        .limit(1);
      if (!house) throw notFound('Дом');

      const region = data.regions.find((r) => r.meta.code === house.regionCode);
      const category = region?.categories.find((c) => c.code === row.category);
      if (!region || !category) throw notFound('Категория');

      const [membership] = await db
        .select({
          apartmentLabel: memberships.apartmentLabel,
          areaM2: memberships.apartmentAreaM2,
          residents: memberships.residents,
          monthlyChargeKopecks: memberships.monthlyChargeKopecks,
        })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.role, 'resident')))
        .limit(1);

      const [measurementRows, joinRows] = await Promise.all([
        db
          .select()
          .from(measurementsTable)
          .where(eq(measurementsTable.requestId, row.id))
          .orderBy(asc(measurementsTable.measuredAt)),
        db.select().from(joins).where(eq(joins.requestId, row.id)).orderBy(asc(joins.joinedAt)),
      ]);

      const own = measurementRows.filter((m) => m.joinerUserId === null).map(toMeasurement);
      const now = clock.now();

      const liability = liabilityFor(
        {
          requestId: row.id,
          category,
          region,
          rules: data.rules,
          tz: house.tz,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          plannedNotice: row.plannedNotice,
          accident: row.accident,
          measurements: own,
          affectedApartments: 1 + joinRows.length,
          billing: {
            monthlyChargeKopecks: membership?.monthlyChargeKopecks ?? null,
            apartmentAreaM2: membership?.areaM2 ?? null,
            residents: membership?.residents ?? null,
          },
        },
        now,
      );

      return {
        row,
        house,
        region,
        category,
        apartmentLabel: membership?.apartmentLabel ?? '',
        measurements: own,
        joinRows,
        liability,
        now,
      };
    }

    const send = (reply: FastifyReply, name: string, pdf: Buffer) =>
      reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${name}"`)
        .send(pdf);

    app.get(
      '/api/requests/:id/documents/claim.pdf',
      { preHandler: authenticate },
      async (req, reply) => {
        const { userId } = getAuth(req);
        const { id } = req.params as { id: string };
        const ctx = await context(id, userId);

        if (!ctx.liability || ctx.liability.apartmentKopecks <= 0) {
          throw conflict('Пока нечего требовать: перерасчёт по этой заявке не насчитан');
        }

        const org = ctx.region.orgs.find((o) => o.id === ctx.house.orgId);
        const verdictRule =
          ctx.category.qualityRule &&
          data.rules.quality.find((r) => r.id === ctx.category.qualityRule);

        const pdf = await buildClaimPdf({
          org: { name: org?.name ?? 'Управляющая организация', address: org?.address ?? null },
          house: { address: ctx.house.address, tz: ctx.house.tz },
          applicant: { apartmentLabel: ctx.apartmentLabel },
          request: {
            number: ctx.row.number,
            title: ctx.category.title,
            description: ctx.row.description,
            startedAt: ctx.row.startedAt.toISOString(),
            endedAt: ctx.row.endedAt?.toISOString() ?? null,
            createdAt: ctx.row.createdAt.toISOString(),
          },
          verdict: verdictRule
            ? {
                normText: `не ниже ${verdictRule.norm.celsius} °C`,
                actualText: `${ctx.measurements[0]?.value ?? '—'} °C`,
                ref: `${verdictRule.source.act ?? ''}, ${verdictRule.source.point ?? ''}`.trim(),
              }
            : null,
          measurements: ctx.measurements,
          liability: ctx.liability,
          joiners: ctx.joinRows.map((j) => j.apartmentLabel),
          asOf: ctx.now.toISOString(),
        });

        return send(reply, `claim-${ctx.row.number}.pdf`, pdf);
      },
    );

    app.get(
      '/api/requests/:id/documents/gji.pdf',
      { preHandler: authenticate },
      async (req, reply) => {
        const { userId } = getAuth(req);
        const { id } = req.params as { id: string };
        const ctx = await context(id, userId);

        const steps = escalation({
          status: ctx.row.status as RequestStatus,
          dueAt: ctx.row.dueAt,
          now: ctx.now,
          hasLiability: (ctx.liability?.apartmentKopecks ?? 0) > 0,
        });

        // Жалобу принимают только после того, как истёк срок ответа управляющей организации.
        if (!steps.gji.available) {
          throw conflict(
            isClosed(ctx.row.status as RequestStatus)
              ? 'Заявка закрыта — обращаться в инспекцию не нужно'
              : 'Срок ответа управляющей организации ещё не истёк',
          );
        }

        const org = ctx.region.orgs.find((o) => o.id === ctx.house.orgId);
        const gji = ctx.region.orgs.find((o) => o.type === 'gji');

        const pdf = await buildGjiPdf({
          gji: {
            name: gji?.name ?? 'Орган государственного жилищного надзора',
            address: gji?.address ?? null,
          },
          org: { name: org?.name ?? 'Управляющая организация' },
          house: { address: ctx.house.address, tz: ctx.house.tz },
          applicant: { apartmentLabel: ctx.apartmentLabel },
          request: {
            number: ctx.row.number,
            title: ctx.category.title,
            description: ctx.row.description,
            createdAt: ctx.row.createdAt.toISOString(),
            startedAt: ctx.row.startedAt.toISOString(),
            dueAt: ctx.row.dueAt.toISOString(),
          },
          apartments: 1 + ctx.joinRows.length,
          asOf: ctx.now.toISOString(),
        });

        return send(reply, `gji-${ctx.row.number}.pdf`, pdf);
      },
    );
  };
