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
  done: 3,
  reopened: 3,
  confirmed: 4,
};

export function buildTimeline(status: RequestStatus, events: RequestEvent[]): TimelineStep[] {
  const current = rank[status];
  return order.map((o, i) => {
    const ev = events.find(
      (e) => e.type === o.status || (o.status === 'new' && e.type === 'created'),
    );
    const state: TimelineStep['state'] = i < current ? 'done' : i === current ? 'current' : 'todo';
    return {
      label: state === 'todo' ? o.todo : o.label,
      state,
      ...(ev ? { at: fmtDateTime(ev.at) } : {}),
    };
  });
}
