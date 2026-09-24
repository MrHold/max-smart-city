import type { RequestStatus } from './contracts';
import { isClosed } from './workflow';

/**
 * Одна авария рождает десятки одинаковых заявок. Диспетчеру нужна одна строка
 * с масштабом, а не сорок строк подряд, поэтому заявки одного дома по одной причине,
 * начавшиеся примерно одновременно, собираются в кластер.
 */
export interface ClusterableRequest {
  id: string;
  houseId: string;
  category: string;
  status: RequestStatus;
  startedAt: Date;
  dueAt: Date;
  /** Сколько соседей присоединилось к этой заявке. */
  joinersCount: number;
  /** Оценка снижения платы по квартирам этой заявки, в копейках. */
  houseKopecks: number;
  perHourHouseKopecks: number;
}

export interface Cluster {
  key: string;
  houseId: string;
  category: string;
  requestIds: string[];
  /** Заявитель плюс присоединившиеся — по всем заявкам кластера. */
  apartments: number;
  startedAt: Date;
  /** Самый ранний срок в кластере: по нему кластер считается просроченным. */
  dueAt: Date;
  overdue: boolean;
  kopecks: number;
  perHourKopecks: number;
}

export interface ClusterOptions {
  /** Разбег во времени, при котором заявки считаются одной причиной. */
  windowHours?: number;
}

const HOUR_MS = 3_600_000;

/**
 * Собирает открытые заявки в кластеры. Закрытые не группируются: они уже не требуют
 * действий диспетчера, а их сроки и суммы зафиксированы.
 *
 * Кластеры возвращаются в порядке срочности: сначала просроченные, затем те,
 * у кого срок ближе.
 */
export function cluster(requests: ClusterableRequest[], now: Date, options: ClusterOptions = {}) {
  const windowMs = (options.windowHours ?? 12) * HOUR_MS;
  const open = requests
    .filter((r) => !isClosed(r.status))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const clusters: Cluster[] = [];

  for (const request of open) {
    const existing = clusters.find(
      (c) =>
        c.houseId === request.houseId &&
        c.category === request.category &&
        request.startedAt.getTime() - c.startedAt.getTime() <= windowMs,
    );

    if (existing) {
      existing.requestIds.push(request.id);
      existing.apartments += 1 + request.joinersCount;
      existing.kopecks += request.houseKopecks;
      existing.perHourKopecks += request.perHourHouseKopecks;
      if (request.dueAt.getTime() < existing.dueAt.getTime()) existing.dueAt = request.dueAt;
      continue;
    }

    clusters.push({
      key: `${request.houseId}:${request.category}:${request.startedAt.toISOString()}`,
      houseId: request.houseId,
      category: request.category,
      requestIds: [request.id],
      apartments: 1 + request.joinersCount,
      startedAt: request.startedAt,
      dueAt: request.dueAt,
      overdue: false,
      kopecks: request.houseKopecks,
      perHourKopecks: request.perHourHouseKopecks,
    });
  }

  for (const c of clusters) c.overdue = now.getTime() > c.dueAt.getTime();

  return clusters.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return a.dueAt.getTime() - b.dueAt.getTime();
  });
}
