import { describe, expect, it } from 'vitest';
import { canTransition, escalation, isClosed, TransitionError, transition } from './workflow';

describe('переходы', () => {
  it('обычный путь заявки', () => {
    let status = transition('new', 'accept');
    expect(status).toBe('accepted');
    status = transition(status, 'assign');
    expect(status).toBe('assigned');
    status = transition(status, 'start');
    expect(status).toBe('in_progress');
    status = transition(status, 'complete');
    expect(status).toBe('done');
    expect(transition(status, 'confirm')).toBe('confirmed');
  });

  it('житель может вернуть работу в работу', () => {
    const reopened = transition('done', 'reopen');
    expect(reopened).toBe('reopened');
    expect(transition(reopened, 'complete')).toBe('done');
  });

  it('исполнитель может отказаться — заявка возвращается диспетчеру', () => {
    expect(transition('assigned', 'decline')).toBe('accepted');
    expect(transition('in_progress', 'decline')).toBe('accepted');
    // После отказа диспетчер назначает другого.
    expect(transition('accepted', 'assign')).toBe('assigned');
  });

  it('отказаться можно только от назначенной работы', () => {
    expect(canTransition('new', 'decline')).toBe(false);
    expect(canTransition('done', 'decline')).toBe(false);
  });

  it('закрытую заявку не трогаем', () => {
    expect(() => transition('confirmed', 'reopen')).toThrow(TransitionError);
    expect(() => transition('rejected', 'assign')).toThrow(TransitionError);
  });

  it('нельзя выполнить работу, которую не приняли', () => {
    expect(canTransition('new', 'complete')).toBe(false);
    expect(() => transition('new', 'complete')).toThrow(/нельзя выполнить/);
  });

  it('заявку можно переназначить другому исполнителю', () => {
    expect(transition('assigned', 'assign')).toBe('assigned');
  });

  it('закрытыми считаются только подтверждённая и отклонённая', () => {
    expect(isClosed('confirmed')).toBe(true);
    expect(isClosed('rejected')).toBe(true);
    expect(isClosed('done')).toBe(false);
    expect(isClosed('reopened')).toBe(false);
  });
});

describe('эскалация', () => {
  const dueAt = new Date('2026-11-09T12:00:00Z');

  it('до истечения срока жалоба в ГЖИ закрыта, но дата известна', () => {
    const steps = escalation({
      status: 'assigned',
      dueAt,
      now: new Date('2026-11-09T10:00:00Z'),
      hasLiability: true,
    });
    expect(steps.gji.available).toBe(false);
    expect(steps.gji.afterAt).toBe(dueAt.toISOString());
  });

  it('после истечения срока жалоба открывается', () => {
    const steps = escalation({
      status: 'assigned',
      dueAt,
      now: new Date('2026-11-09T12:30:00Z'),
      hasLiability: true,
    });
    expect(steps.gji.available).toBe(true);
  });

  it('у закрытой заявки эскалации нет', () => {
    const steps = escalation({
      status: 'confirmed',
      dueAt,
      now: new Date('2026-11-20T00:00:00Z'),
      hasLiability: true,
    });
    expect(steps.gji.available).toBe(false);
    expect(steps.gji.afterAt).toBeNull();
  });

  it('заявление о перерасчёте появляется только вместе с суммой', () => {
    const withMoney = escalation({
      status: 'done',
      dueAt,
      now: dueAt,
      hasLiability: true,
    });
    const without = escalation({
      status: 'done',
      dueAt,
      now: dueAt,
      hasLiability: false,
    });
    expect(withMoney.claim.available).toBe(true);
    expect(without.claim.available).toBe(false);
  });

  it('по отклонённой заявке заявление не предлагаем', () => {
    const steps = escalation({
      status: 'rejected',
      dueAt,
      now: dueAt,
      hasLiability: true,
    });
    expect(steps.claim.available).toBe(false);
  });
});
