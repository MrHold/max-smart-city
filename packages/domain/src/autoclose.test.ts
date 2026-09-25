import { describe, expect, it } from 'vitest';
import { AUTO_CLOSE_DAYS, autoCloseThreshold, isStaleForAutoClose } from './autoclose';

const done = new Date('2026-11-10T12:00:00Z');
const at = (iso: string) => new Date(iso);

describe('автозакрытие', () => {
  it('до трёх суток заявка остаётся открытой', () => {
    expect(isStaleForAutoClose('done', done, at('2026-11-13T11:59:00Z'))).toBe(false);
  });

  it('ровно через трое суток закрывается', () => {
    expect(isStaleForAutoClose('done', done, at('2026-11-13T12:00:00Z'))).toBe(true);
  });

  it('срок считается от выполнения, а не от подачи', () => {
    // Подана давно, но выполнена только что — трое суток ещё не прошли.
    expect(
      isStaleForAutoClose('done', at('2026-11-13T10:00:00Z'), at('2026-11-13T12:00:00Z')),
    ).toBe(false);
  });

  it('закрывается только выполненная заявка', () => {
    for (const status of ['new', 'accepted', 'assigned', 'in_progress', 'reopened'] as const) {
      expect(isStaleForAutoClose(status, done, at('2026-12-01T00:00:00Z')), status).toBe(false);
    }
  });

  it('уже закрытые и отклонённые не трогаем', () => {
    expect(isStaleForAutoClose('confirmed', done, at('2026-12-01T00:00:00Z'))).toBe(false);
    expect(isStaleForAutoClose('rejected', done, at('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('без момента выполнения закрывать нечего', () => {
    expect(isStaleForAutoClose('done', null, at('2026-12-01T00:00:00Z'))).toBe(false);
  });

  it('порог согласован с проверкой', () => {
    const now = at('2026-11-13T12:00:00Z');
    expect(autoCloseThreshold(now).toISOString()).toBe(done.toISOString());
    expect(AUTO_CLOSE_DAYS).toBe(3);
  });

  it('срок можно изменить', () => {
    expect(isStaleForAutoClose('done', done, at('2026-11-11T12:00:00Z'), 1)).toBe(true);
  });
});
