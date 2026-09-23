import { createHmac, timingSafeEqual } from 'node:crypto';

/** Пользователь MAX из initData (поле user). */
export interface MaxUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface InitData {
  user: MaxUser;
  authDate: Date;
  startParam?: string;
  queryId?: string;
  /** все поля как пришли, после URL-декодирования */
  raw: Record<string, string>;
}

export type InitDataResult =
  | { ok: true; data: InitData }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'no_user' };

/** Разбор строки key1=value1&key2=value2 с URL-декодированием значений (как в документации MAX). */
function parse(initData: string): Map<string, string[]> | null {
  const fields = new Map<string, string[]>();
  for (const part of initData.split('&')) {
    if (part === '') continue;
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = part.slice(0, eq);
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
    const list = fields.get(key) ?? [];
    list.push(value);
    fields.set(key, list);
  }
  return fields;
}

/** Строка для подписи: все поля, кроме hash, по алфавиту, key=value через перевод строки. */
export function buildCheckString(fields: Record<string, string>): string {
  return Object.keys(fields)
    .filter((k) => k !== 'hash')
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
}

/** Подпись по алгоритму MAX: secret = HMAC_SHA256(key='WebAppData', msg=botToken). */
export function signCheckString(checkString: string, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secret).update(checkString).digest('hex');
}

/**
 * Проверяет подпись initData из мини-приложения MAX.
 * now — параметром (демо-часы, тесты); maxAgeSec — сколько живут данные запуска.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  now: Date,
  maxAgeSec = 3600,
): InitDataResult {
  const parsed = parse(initData);
  if (!parsed) return { ok: false, reason: 'malformed' };

  const fields: Record<string, string> = {};
  for (const [key, values] of parsed) {
    if (values.length !== 1) return { ok: false, reason: 'malformed' }; // дубли ключей не принимаем
    fields[key] = values[0] as string;
  }

  const hash = fields.hash;
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'malformed' };

  const expected = Buffer.from(signCheckString(buildCheckString(fields), botToken), 'hex');
  const received = Buffer.from(hash, 'hex');
  if (!timingSafeEqual(expected, received)) return { ok: false, reason: 'bad_signature' };

  const authDateSec = Number(fields.auth_date);
  if (!Number.isFinite(authDateSec)) return { ok: false, reason: 'malformed' };
  const ageSec = now.getTime() / 1000 - authDateSec;
  if (ageSec > maxAgeSec) return { ok: false, reason: 'expired' };

  if (!fields.user) return { ok: false, reason: 'no_user' };
  let user: MaxUser;
  try {
    user = JSON.parse(fields.user) as MaxUser;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof user.id !== 'number') return { ok: false, reason: 'no_user' };

  return {
    ok: true,
    data: {
      user,
      authDate: new Date(authDateSec * 1000),
      startParam: fields.start_param,
      queryId: fields.query_id,
      raw: fields,
    },
  };
}

/**
 * Собрать подписанную initData — для тестов и мока MAX Bridge в мини-приложении.
 * В продакшене initData подписывает сам MAX.
 */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const hash = signCheckString(buildCheckString(fields), botToken);
  const entries: [string, string][] = [...Object.entries(fields), ['hash', hash]];
  return entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
