import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * Хеш MAX user_id для поиска пользователя в БД. Необратим; без секрета его не подобрать
 * перебором по известным id.
 */
export function userHash(maxUserId: number, secret: string): string {
  return createHmac('sha256', secret).update(String(maxUserId)).digest('hex');
}

/** Ключ AES-256 из переменной окружения: 32 байта в base64 (openssl rand -base64 32). */
export function parseEncKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('USER_ID_ENC_KEY должен быть 32 байта в base64');
  return key;
}

/** Шифрует MAX user_id (AES-256-GCM). Результат: base64(iv | tag | ciphertext). */
export function encryptUserId(maxUserId: number, key: Buffer): string {
  const iv = randomBytes(12); // новый случайный IV на каждую запись
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(maxUserId), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/** Расшифровка для outbox: нужен настоящий id, чтобы написать человеку в MAX. */
export function decryptUserId(encrypted: string, key: Buffer): number {
  const buf = Buffer.from(encrypted, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return Number(plain);
}
