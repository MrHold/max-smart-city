import { describe, expect, it } from 'vitest';
import { signInitData, validateInitData } from './init-data';

const token = 'test-bot-token';
const now = new Date('2026-09-28T12:00:00Z');
const nowSec = Math.floor(now.getTime() / 1000);
const user = JSON.stringify({ id: 42, first_name: 'Тест' });

const signed = (authDateSec: number, userJson = user) =>
  signInitData({ auth_date: String(authDateSec), user: userJson }, token);

describe('initData: окно времени (S9)', () => {
  it('свежая подпись проходит', () => {
    expect(validateInitData(signed(nowSec - 10), token, now).ok).toBe(true);
  });

  it('часы телефона спешат на 30 секунд — всё равно пускаем', () => {
    expect(validateInitData(signed(nowSec + 30), token, now).ok).toBe(true);
  });

  it('подпись из будущего (через час) — отказ', () => {
    expect(validateInitData(signed(nowSec + 3600), token, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('просроченная подпись — отказ', () => {
    expect(validateInitData(signed(nowSec - 7200), token, now)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });
});

describe('initData: поле user (S9)', () => {
  it.each([
    ['отрицательный id', { id: -1, first_name: 'Тест' }],
    ['дробный id', { id: 1.5, first_name: 'Тест' }],
    ['id строкой', { id: '42', first_name: 'Тест' }],
    ['без имени', { id: 42 }],
    ['не объект', 42],
  ])('%s — no_user', (_title, bad) => {
    expect(validateInitData(signed(nowSec, JSON.stringify(bad)), token, now)).toEqual({
      ok: false,
      reason: 'no_user',
    });
  });
});
