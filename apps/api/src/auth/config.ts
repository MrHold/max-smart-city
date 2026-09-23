import { parseEncKey } from './identity';

export interface AuthConfig {
  /** Токен бота: им MAX подписывает initData */
  botToken: string;
  /** Секрет для users.user_hash */
  hashSecret: string;
  /** Ключ AES-256 для users.user_id_enc */
  encKey: Buffer;
  /** Сколько секунд initData считается свежей */
  maxAgeSec: number;
}

/** Собирает настройки входа из переменных окружения. Возвращает список недостающих, если чего-то нет. */
export function authConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: AuthConfig } | { ok: false; missing: string[] } {
  const required = ['BOT_TOKEN', 'USER_HASH_SECRET', 'USER_ID_ENC_KEY'] as const;
  const missing = required.filter((name) => !env[name]);
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      botToken: env.BOT_TOKEN as string,
      hashSecret: env.USER_HASH_SECRET as string,
      encKey: parseEncKey(env.USER_ID_ENC_KEY as string),
      maxAgeSec: Number(env.INIT_DATA_MAX_AGE_SEC ?? 3600),
    },
  };
}
