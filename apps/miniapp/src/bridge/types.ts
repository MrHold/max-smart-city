export type Platform = 'ios' | 'android' | 'desktop' | 'web';

export interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export interface WebAppInitData {
  query_id?: string;
  auth_date: number;
  hash: string;
  user?: WebAppUser;
  chat?: { id: number; type: 'DIALOG' | 'CHAT' | 'CHANNEL' };
  start_param?: string;
}

export interface WebApp {
  initData: string;
  initDataUnsafe: WebAppInitData;
  platform: Platform;
  version: string;
  deviceName?: string;
  getViewportSize?: () => Promise<{ width: string; height: string }>;
  requestContact?: () => Promise<unknown>;
  shareMaxContent?: (p: {
    mid?: string;
    chatType?: 'DIALOG' | 'CHAT';
    text?: string;
  }) => Promise<unknown>;
  /** Только https и только по клику пользователя; в веб-версии MAX не работает. */
  downloadFile?: (url: string, fileName: string) => Promise<unknown>;
  openLink?: (url: string) => void;
}

declare global {
  interface Window {
    WebApp?: WebApp;
  }
}
