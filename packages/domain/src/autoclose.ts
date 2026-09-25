import type { RequestStatus } from './contracts';

/**
 * Сколько заявка может висеть в состоянии «выполнена», если житель не подтвердил работу.
 * Без этого правила в кабинете диспетчера копятся заявки, по которым давно всё сделано.
 */
export const AUTO_CLOSE_DAYS = 3;

const DAY_MS = 86_400_000;

/**
 * Пора ли закрывать заявку сама.
 *
 * Закрывается только выполненная заявка: житель уже получил уведомление и не ответил.
 * Возвращённая в работу или ещё не выполненная не закрывается никогда — молчание жителя
 * там ничего не значит. Срок считается от момента выполнения, а не от подачи заявки.
 */
export function isStaleForAutoClose(
  status: RequestStatus,
  completedAt: Date | null,
  now: Date,
  days = AUTO_CLOSE_DAYS,
): boolean {
  if (status !== 'done' || !completedAt) return false;
  return now.getTime() - completedAt.getTime() >= days * DAY_MS;
}

/** Момент, начиная с которого выполненная заявка считается забытой. */
export const autoCloseThreshold = (now: Date, days = AUTO_CLOSE_DAYS): Date =>
  new Date(now.getTime() - days * DAY_MS);
