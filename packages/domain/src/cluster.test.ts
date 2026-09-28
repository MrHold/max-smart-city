import { describe, expect, it } from 'vitest';
import { type ClusterableRequest, cluster } from './cluster';
import type { RequestStatus } from './contracts';

const now = new Date('2026-11-10T12:00:00Z');

const req = (over: Partial<ClusterableRequest> & { id: string }): ClusterableRequest => ({
  houseId: 'house-1',
  category: 'heating',
  status: 'accepted' as RequestStatus,
  startedAt: new Date('2026-11-10T06:00:00Z'),
  dueAt: new Date('2026-11-10T08:00:00Z'),
  endedAt: null,
  joinersCount: 0,
  houseKopecks: 6496,
  perHourHouseKopecks: 1082,
  ...over,
});

describe('кластеры', () => {
  it('одна причина в одном доме — одна строка у диспетчера', () => {
    const result = cluster([req({ id: 'a' }), req({ id: 'b' }), req({ id: 'c' })], now);
    expect(result).toHaveLength(1);
    expect(result[0]?.requestIds).toEqual(['a', 'b', 'c']);
    expect(result[0]?.apartments).toBe(3);
  });

  it('квартиры считаются вместе с присоединившимися', () => {
    const result = cluster([req({ id: 'a', joinersCount: 13 }), req({ id: 'b' })], now);
    expect(result[0]?.apartments).toBe(15);
  });

  it('деньги по кластеру складываются', () => {
    const result = cluster(
      [req({ id: 'a', houseKopecks: 6496 }), req({ id: 'b', houseKopecks: 3000 })],
      now,
    );
    expect(result[0]?.kopecks).toBe(9496);
    expect(result[0]?.perHourKopecks).toBe(2164);
  });

  it('разные дома не смешиваются', () => {
    const result = cluster([req({ id: 'a' }), req({ id: 'b', houseId: 'house-2' })], now);
    expect(result).toHaveLength(2);
  });

  it('разные причины не смешиваются', () => {
    const result = cluster([req({ id: 'a' }), req({ id: 'b', category: 'elevator' })], now);
    expect(result).toHaveLength(2);
  });

  it('заявка через двое суток — это уже другая авария', () => {
    const result = cluster(
      [req({ id: 'a' }), req({ id: 'b', startedAt: new Date('2026-11-12T06:00:00Z') })],
      now,
    );
    expect(result).toHaveLength(2);
  });

  it('закрытые заявки в работу диспетчера не попадают', () => {
    const result = cluster(
      [
        req({ id: 'a', status: 'confirmed' }),
        req({ id: 'b', status: 'rejected' }),
        req({ id: 'c' }),
      ],
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.requestIds).toEqual(['c']);
  });

  it('срок кластера — самый ранний из заявок', () => {
    const result = cluster(
      [
        req({ id: 'a', dueAt: new Date('2026-11-10T09:00:00Z') }),
        req({ id: 'b', dueAt: new Date('2026-11-10T07:00:00Z') }),
      ],
      now,
    );
    expect(result[0]?.dueAt.toISOString()).toBe('2026-11-10T07:00:00.000Z');
  });

  it('просроченные показываются первыми, дальше по близости срока', () => {
    const result = cluster(
      [
        req({
          id: 'запас',
          category: 'elevator',
          startedAt: new Date('2026-11-10T11:00:00Z'),
          dueAt: new Date('2026-11-10T20:00:00Z'),
        }),
        req({
          id: 'скоро',
          category: 'entrance_light',
          startedAt: new Date('2026-11-10T11:30:00Z'),
          dueAt: new Date('2026-11-10T13:00:00Z'),
        }),
        req({ id: 'просрочено' }),
      ],
      now,
    );
    expect(result.map((c) => c.requestIds[0])).toEqual(['просрочено', 'скоро', 'запас']);
    expect(result[0]?.overdue).toBe(true);
    expect(result[1]?.overdue).toBe(false);
  });

  it('пустой список не ломается', () => {
    expect(cluster([], now)).toEqual([]);
  });

  it('работу закрыли в срок — заявка не просрочена, даже если срок давно прошёл', () => {
    // Статус 'done' — заявка ещё не закрыта (ждёт подтверждения жителя), но executed on time.
    const result = cluster(
      [
        req({
          id: 'a',
          status: 'done',
          dueAt: new Date('2026-11-10T08:00:00Z'),
          endedAt: new Date('2026-11-10T07:30:00Z'),
        }),
      ],
      now,
    );
    expect(result[0]?.overdue).toBe(false);
  });

  it('кластер просрочен, если просрочена хотя бы одна заявка в нём', () => {
    const result = cluster(
      [
        req({
          id: 'вовремя',
          status: 'done',
          dueAt: new Date('2026-11-10T08:00:00Z'),
          endedAt: new Date('2026-11-10T07:30:00Z'),
        }),
        req({ id: 'просрочена', dueAt: new Date('2026-11-10T08:00:00Z') }),
      ],
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.overdue).toBe(true);
  });
});
