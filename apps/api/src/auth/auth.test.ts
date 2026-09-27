import { randomBytes } from 'node:crypto';
import { decryptUserId, encryptUserId, parseEncKey, userHash } from '@msc/db';
import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from './init-data';

const TOKEN = 'test-bot-token';
const now = new Date('2026-09-24T10:00:00Z');
const authDate = String(Math.floor(now.getTime() / 1000) - 60);
const user = JSON.stringify({ id: 423207517, first_name: 'Гоша', username: 'gosha' });

describe('validateInitData', () => {
  it('принимает правильно подписанные данные', () => {
    const initData = signInitData({ auth_date: authDate, query_id: 'q1', user }, TOKEN);
    const res = validateInitData(initData, TOKEN, now);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.user.id).toBe(423207517);
      expect(res.data.user.first_name).toBe('Гоша');
    }
  });

  it('отдаёт start_param из диплинка', () => {
    const initData = signInitData({ auth_date: authDate, user, start_param: 'r_abc' }, TOKEN);
    const res = validateInitData(initData, TOKEN, now);
    expect(res.ok && res.data.startParam).toBe('r_abc');
  });

  it('отклоняет подпись чужим токеном', () => {
    const initData = signInitData({ auth_date: authDate, user }, 'other-token');
    expect(validateInitData(initData, TOKEN, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет подменённого пользователя', () => {
    const initData = signInitData({ auth_date: authDate, user }, TOKEN);
    const forged = initData.replace('423207517', '1');
    expect(validateInitData(forged, TOKEN, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет устаревшие данные', () => {
    const old = String(Math.floor(now.getTime() / 1000) - 7200);
    const initData = signInitData({ auth_date: old, user }, TOKEN);
    expect(validateInitData(initData, TOKEN, now)).toEqual({ ok: false, reason: 'expired' });
  });

  it('отклоняет данные без hash и мусор', () => {
    expect(validateInitData(`auth_date=${authDate}`, TOKEN, now).ok).toBe(false);
    expect(validateInitData('', TOKEN, now).ok).toBe(false);
    expect(validateInitData('%%%', TOKEN, now).ok).toBe(false);
  });

  it('отклоняет повтор ключа hash', () => {
    const initData = signInitData({ auth_date: authDate, user }, TOKEN);
    expect(validateInitData(`${initData}&hash=${'0'.repeat(64)}`, TOKEN, now).ok).toBe(false);
  });

  it('без user — no_user', () => {
    const initData = signInitData({ auth_date: authDate }, TOKEN);
    expect(validateInitData(initData, TOKEN, now)).toEqual({ ok: false, reason: 'no_user' });
  });

  it('принимает данные, где пробел закодирован как «+» (так кодируют часть клиентов)', () => {
    const spaced = JSON.stringify({ id: 423207517, first_name: 'Анна Мария' });
    // signInitData кодирует пробел как %20; меняем на «+», как в кодировании веб-форм
    const withPlus = signInitData({ auth_date: authDate, user: spaced }, TOKEN).replace(
      /%20/g,
      '+',
    );
    expect(withPlus).toContain('+');
    const res = validateInitData(withPlus, TOKEN, now);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.user.first_name).toBe('Анна Мария');
  });

  it('второй способ раскодирования не пропускает подделку', () => {
    const spaced = JSON.stringify({ id: 423207517, first_name: 'Анна Мария' });
    const withPlus = signInitData({ auth_date: authDate, user: spaced }, TOKEN).replace(
      /%20/g,
      '+',
    );
    const forged = withPlus.replace('423207517', '1');
    expect(validateInitData(forged, TOKEN, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('identity', () => {
  const key = parseEncKey(randomBytes(32).toString('base64'));

  it('хеш стабильный и зависит от секрета', () => {
    expect(userHash(1, 's')).toBe(userHash(1, 's'));
    expect(userHash(1, 's')).not.toBe(userHash(1, 't'));
  });

  it('шифрование обратимо, но каждый раз разное', () => {
    const a = encryptUserId(423207517, key);
    const b = encryptUserId(423207517, key);
    expect(a).not.toBe(b);
    expect(decryptUserId(a, key)).toBe(423207517);
  });

  it('подделанный шифр не расшифровывается', () => {
    const enc = Buffer.from(encryptUserId(42, key), 'base64');
    const last = enc.length - 1;
    enc.writeUInt8(enc.readUInt8(last) ^ 1, last);
    expect(() => decryptUserId(enc.toString('base64'), key)).toThrow();
  });

  it('ключ неверной длины отклоняется', () => {
    expect(() => parseEncKey(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});
