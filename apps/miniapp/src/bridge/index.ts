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
    window.WebApp = createMockWebApp(startParam);
    installedMock = true;
  }
  return window.WebApp as WebApp;
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
