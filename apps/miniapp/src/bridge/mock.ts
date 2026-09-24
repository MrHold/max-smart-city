import type { WebApp, WebAppInitData } from './types';

const mockUser = {
  id: 100500,
  first_name: 'Тест',
  last_name: 'Житель',
  username: 'test_resident',
  language_code: 'ru',
};

function parseSigned(signed: string): Partial<WebAppInitData> {
  const p = new URLSearchParams(signed);
  const out: Partial<WebAppInitData> = {};
  const authDate = p.get('auth_date');
  if (authDate) out.auth_date = Number(authDate);
  const hash = p.get('hash');
  if (hash) out.hash = hash;
  const queryId = p.get('query_id');
  if (queryId) out.query_id = queryId;
  const user = p.get('user');
  if (user) {
    try {
      out.user = JSON.parse(user) as WebAppInitData['user'];
    } catch {}
  }
  return out;
}

function encodeInitData(data: WebAppInitData): string {
  const entries: [string, string][] = [
    ['auth_date', String(data.auth_date)],
    ['hash', data.hash],
    ['user', JSON.stringify(data.user)],
  ];
  if (data.start_param) entries.push(['start_param', data.start_param]);
  if (data.query_id) entries.push(['query_id', data.query_id]);
  return entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

/**
 * Мок Bridge для браузера. Если задана VITE_DEV_INIT_DATA (подписанная строка от
 * `pnpm --filter @msc/api sign-init-data`), она уходит в API как есть — подпись проверится.
 * startapp из адреса добавляется только в initDataUnsafe: подписанную строку менять нельзя.
 */
export function createMockWebApp(startParam?: string, signed?: string): WebApp {
  const fromSigned = signed ? parseSigned(signed) : null;
  const unsafe: WebAppInitData = {
    query_id: 'mock-session',
    auth_date: Math.floor(Date.now() / 1000),
    hash: 'mock',
    user: mockUser,
    chat: { id: 1, type: 'DIALOG' },
    ...fromSigned,
    ...(startParam ? { start_param: startParam } : {}),
  };
  return {
    initData: signed ?? encodeInitData(unsafe),
    initDataUnsafe: unsafe,
    platform: 'web',
    version: 'mock',
    deviceName: 'browser',
    getViewportSize: async () => ({
      width: String(window.innerWidth),
      height: String(window.innerHeight),
    }),
  };
}
