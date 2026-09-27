import { type Db, encryptUserId, eq, userHash, users } from '@msc/db';
import type { Clock } from '@msc/domain';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../errors';
import type { AuthConfig } from './config';
import { type MaxUser, validateInitData } from './init-data';

/** Кто делает запрос. Кладётся в req.auth после проверки initData. */
export interface AuthContext {
  /** users.id в нашей БД */
  userId: string;
  /** Данные профиля MAX из initData: имя, username, фото */
  maxUser: MaxUser;
  /** Параметр диплинка startapp=…, если мини-приложение открыли по ссылке */
  startParam?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const unauthorized = (code: string, message: string) => new ApiError(401, code, message);

/**
 * preHandler для маршрутов, которым нужен пользователь:
 *   app.get('/api/…', { preHandler: authenticate }, async (req) => { const { userId } = getAuth(req); … })
 * Проверяет подпись initData из заголовка X-Init-Data и находит (или создаёт) пользователя в БД.
 */
export function makeAuthenticate(deps: { db: Db; config: AuthConfig; clock: Clock }) {
  const { db, config, clock } = deps;

  return async function authenticate(req: FastifyRequest): Promise<void> {
    const header = req.headers['x-init-data'];
    const initData = Array.isArray(header) ? header[0] : header;
    if (!initData) throw unauthorized('unauthorized', 'Откройте приложение из бота в MAX');

    const result = validateInitData(initData, config.botToken, clock.now(), config.maxAgeSec);
    if (!result.ok) {
      // В лог — только почему не прошло и какие поля пришли, без значений: initData — пропуск на час
      req.log.warn(
        {
          reason: result.reason,
          fields: initData.split('&').map((part) => part.split('=')[0]),
          length: initData.length,
          hasPlus: initData.includes('+'),
        },
        'initData не прошла проверку',
      );
      if (result.reason === 'expired') {
        throw unauthorized(
          'init_data_expired',
          'Сессия устарела — закройте и откройте приложение заново',
        );
      }
      throw unauthorized('unauthorized', 'Не удалось подтвердить вход через MAX');
    }

    const { user: maxUser, startParam } = result.data;
    const hash = userHash(maxUser.id, config.hashSecret);

    let userId = await findUserId(db, hash);
    if (!userId) {
      // первый вход: создаём пользователя; при одновременных первых запросах второй insert
      // упрётся в unique(user_hash) и ничего не сделает — тогда просто читаем ещё раз
      await db
        .insert(users)
        .values({ userHash: hash, userIdEnc: encryptUserId(maxUser.id, config.encKey) })
        .onConflictDoNothing({ target: users.userHash });
      userId = await findUserId(db, hash);
    }
    if (!userId) throw new ApiError(500, 'internal', 'Не удалось создать пользователя');

    req.auth = { userId, maxUser, startParam };
  };
}

async function findUserId(db: Db, hash: string): Promise<string | undefined> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.userHash, hash))
    .limit(1);
  return row?.id;
}

/** Достаёт пользователя из запроса в маршруте, защищённом authenticate. */
export function getAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized('unauthorized', 'Требуется вход через MAX');
  return req.auth;
}
