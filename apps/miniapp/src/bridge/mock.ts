import type { WebApp, WebAppInitData } from './types';

const mockUser = {
  id: 100500,
  first_name: 'Тест',
  last_name: 'Житель',
  username: 'test_resident',
  language_code: 'ru',
};

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

export function createMockWebApp(startParam?: string): WebApp {
  const unsafe: WebAppInitData = {
    query_id: 'mock-session',
    auth_date: Math.floor(Date.now() / 1000),
    hash: 'mock',
    user: mockUser,
    chat: { id: 1, type: 'DIALOG' },
    ...(startParam ? { start_param: startParam } : {}),
  };
  return {
    initData: encodeInitData(unsafe),
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
