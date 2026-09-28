import type { RequestEvent, RequestStatus } from '../api/types';
import type { ChipTone, TimelineStep } from '../ui';
import { fmtDateTime } from './format';

export const statusLabel: Record<RequestStatus, string> = {
  new: 'Отправлена',
  accepted: 'Принята',
  rejected: 'Отклонена',
  assigned: 'Исполнитель назначен',
  in_progress: 'В работе',
  done: 'Выполнена',
  confirmed: 'Закрыта',
  reopened: 'Возвращена',
};

export const statusTone: Record<RequestStatus, ChipTone> = {
  new: 'neutral',
  accepted: 'neutral',
  rejected: 'danger',
  assigned: 'accent',
  in_progress: 'accent',
  done: 'ok',
  confirmed: 'ok',
  reopened: 'warn',
};

export const closedStatuses: RequestStatus[] = ['confirmed', 'rejected'];

const order: Array<{ status: RequestStatus; label: string; todo: string }> = [
  { status: 'new', label: 'Отправлена', todo: 'Отправлена' },
  { status: 'accepted', label: 'Принята диспетчером', todo: 'Принята диспетчером' },
  { status: 'assigned', label: 'Исполнитель назначен', todo: 'Исполнитель назначен' },
  { status: 'done', label: 'Выполнена', todo: 'Выполнена — пришлём фото' },
  { status: 'confirmed', label: 'Вы подтвердили', todo: 'Вы подтверждаете' },
];

const rank: Record<RequestStatus, number> = {
  new: 0,
  accepted: 1,
  rejected: 1,
  assigned: 2,
  in_progress: 2,
  reopened: 2,
  done: 3,
  confirmed: 4,
};

// Типы событий на сервере отличаются от статусов: заявка «done», а событие — «completed»
const eventTypes: Partial<Record<RequestStatus, string[]>> = {
  new: ['created', 'new'],
  accepted: ['accepted'],
  assigned: ['assigned'],
  done: ['completed', 'done'],
  confirmed: ['confirmed'],
};

export function buildTimeline(status: RequestStatus, events: RequestEvent[]): TimelineStep[] {
  const current = rank[status];
  return order.map((o, i) => {
    const types = eventTypes[o.status] ?? [o.status];
    // Последнее событие типа: после возврата в работу шаг проходят повторно
    const ev = [...events].reverse().find((e) => types.includes(e.type));
    const state: TimelineStep['state'] = i < current ? 'done' : i === current ? 'current' : 'todo';
    const label =
      status === 'reopened' && state === 'current'
        ? 'Возвращена в работу — ждём исполнителя'
        : state === 'todo'
          ? o.todo
          : o.label;
    return { label, state, ...(ev ? { at: fmtDateTime(ev.at) } : {}) };
  });
}

/** Причина отказа диспетчера — из события; таймлайн для отклонённой заявки не нужен. */
export function rejectionReason(events: RequestEvent[]): string | null {
  const ev = [...events].reverse().find((e) => e.type === 'rejected');
  if (!ev) return null;
  return ev.label.replace(/^Отклонена:?\s*/i, '') || null;
}
