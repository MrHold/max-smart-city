import { createMockWebApp } from './mock';
import type { Platform, WebApp } from './types';

export type { Platform, WebApp, WebAppInitData, WebAppUser } from './types';

let installedMock = false;

export function ensureWebApp(): WebApp {
  const real = window.WebApp;
  if (real?.initData) return real;
  if (!import.meta.env.DEV && !import.meta.env.VITE_ALLOW_MOCK_BRIDGE) {
    throw new Error('Мини-приложение открыто вне MAX');
  }
  if (!installedMock) {
    const startParam = new URLSearchParams(window.location.search).get('startapp') ?? undefined;
    const signed = import.meta.env.VITE_DEV_INIT_DATA || undefined;
    window.WebApp = createMockWebApp(startParam, signed);
    installedMock = true;
  }
  return window.WebApp as WebApp;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Поделиться через MAX. Вызывать прямо в обработчике нажатия и без await до вызова,
 * иначе клиент не засчитает действие пользователя. Промис даёт причину неудачи или null.
 */
export function shareToMax(p: { text: string; link?: string }): Promise<string | null> {
  let wa: WebApp;
  try {
    wa = ensureWebApp();
  } catch (e) {
    return Promise.resolve(errorText(e));
  }
  if (!wa.shareMaxContent) return Promise.resolve('shareMaxContent нет');
  try {
    return wa.shareMaxContent(p).then(
      () => null,
      (e: unknown) => errorText(e),
    );
  } catch (e) {
    return Promise.resolve(errorText(e));
  }
}

export function isMockBridge(): boolean {
  return installedMock;
}

export function getInitData(): string {
  return ensureWebApp().initData;
}

export function getStartParam(): string | undefined {
  return ensureWebApp().initDataUnsafe.start_param;
}

export function getPlatform(): Platform {
  return ensureWebApp().platform;
}

export function isMobilePlatform(): boolean {
  const p = getPlatform();
  return p === 'ios' || p === 'android';
}
