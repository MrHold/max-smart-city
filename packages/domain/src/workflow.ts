import type { RequestStatus } from './contracts';

/** Что произошло с заявкой. Статус меняется только через transition(), напрямую его не пишем. */
export type WorkflowEvent =
  | 'accept'
  | 'reject'
  | 'assign'
  | 'start'
  | 'complete'
  | 'decline'
  | 'confirm'
  | 'reopen';

const TRANSITIONS: Record<RequestStatus, Partial<Record<WorkflowEvent, RequestStatus>>> = {
  new: { accept: 'accepted', reject: 'rejected' },
  accepted: { assign: 'assigned', reject: 'rejected' },
  // decline — «не могу взять»: заявка возвращается диспетчеру, чтобы он назначил другого.
  assigned: { start: 'in_progress', complete: 'done', assign: 'assigned', decline: 'accepted' },
  in_progress: { complete: 'done', decline: 'accepted' },
  done: { confirm: 'confirmed', reopen: 'reopened' },
  reopened: { assign: 'assigned', start: 'in_progress', complete: 'done' },
  confirmed: {},
  rejected: {},
};

export class TransitionError extends Error {
  constructor(
    readonly from: RequestStatus,
    readonly event: WorkflowEvent,
  ) {
    super(`Из состояния «${from}» нельзя выполнить «${event}»`);
  }
}

export function transition(from: RequestStatus, event: WorkflowEvent): RequestStatus {
  const to = TRANSITIONS[from][event];
  if (!to) throw new TransitionError(from, event);
  return to;
}

export const canTransition = (from: RequestStatus, event: WorkflowEvent): boolean =>
  TRANSITIONS[from][event] !== undefined;

/** Заявка закрыта: ни таймеры, ни эскалация к ней больше не применяются. */
export const isClosed = (status: RequestStatus): boolean =>
  status === 'confirmed' || status === 'rejected';

export interface EscalationInput {
  status: RequestStatus;
  dueAt: Date;
  now: Date;
  /** Есть ли посчитанная сумма перерасчёта. */
  hasLiability: boolean;
  /**
   * Когда работа фактически завершена (исполнитель отметил «Выполнено»), null — ещё не завершена.
   * Если работу закрыли в срок, дальнейшая перемотка часов не должна задним числом делать
   * заявку просроченной: часы для просрочки останавливаются в момент завершения.
   */
  endedAt: Date | null;
}

export interface Escalation {
  claim: { available: boolean };
  gji: { available: boolean; afterAt: string | null };
}

/**
 * Просрочен ли срок ответа. Пока работа не завершена, сравниваем с текущим моментом —
 * обычный «тикающий» таймер. После завершения сравниваем с моментом завершения: если
 * исполнитель закрыл заявку в срок, она не станет просроченной позже, сколько бы времени
 * ни прошло до подтверждения жителем.
 */
export const isOverdue = (dueAt: Date, now: Date, endedAt: Date | null): boolean =>
  (endedAt ?? now).getTime() > dueAt.getTime();

/**
 * Какие шаги открыты жителю.
 *
 * Жалоба в ГЖИ открывается только после того, как истёк срок ответа управляющей организации:
 * поданную раньше её вернут без рассмотрения. До этого момента в карточке показывается дата,
 * с которой шаг станет доступен.
 */
export function escalation(input: EscalationInput): Escalation {
  const closed = isClosed(input.status);
  const overdue = isOverdue(input.dueAt, input.now, input.endedAt);

  return {
    claim: { available: input.hasLiability && input.status !== 'rejected' },
    gji: {
      available: !closed && overdue,
      afterAt: closed ? null : input.dueAt.toISOString(),
    },
  };
}
