import { createHmac, timingSafeEqual } from 'node:crypto';

// Подпись приглашения: 16 hex-символов HMAC. Без секрета ссылку для чужого исполнителя не подделать.
const sign = (executorId: string, secret: string): string =>
  createHmac('sha256', secret).update(`invite:${executorId}`).digest('hex').slice(0, 16);

/** inv_<id исполнителя>_<подпись> — параметр start в ссылке max.ru/<бот>?start=… */
export const inviteToken = (executorId: string, secret: string): string =>
  `inv_${executorId}_${sign(executorId, secret)}`;

/** id исполнителя, если подпись верна, иначе null. */
export function verifyInvite(token: string, secret: string): string | null {
  const match = /^inv_(.+)_([0-9a-f]{16})$/.exec(token);
  if (!match) return null;
  const [, executorId = '', signature = ''] = match;
  const expected = sign(executorId, secret);
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? executorId : null;
}
