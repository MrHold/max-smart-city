import { getInitData } from '../bridge';
import type { ApiErrorBody } from './types';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const useMock = import.meta.env.VITE_API_MOCK === '1';
const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (useMock) {
    const { mockApi } = await import('./mock');
    try {
      return (await mockApi(path, init)) as T;
    } catch (e) {
      const err = e as { code?: string; message?: string; status?: number };
      throw new ApiError(err.code ?? 'mock_error', err.message ?? 'Ошибка мока', err.status ?? 500);
    }
  }

  const headers = new Headers(init.headers);
  headers.set('X-Init-Data', getInitData());
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError('network', 'Нет связи с сервером', 0);
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      err?.code ?? 'http_error',
      err?.message ?? `Ошибка ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

/** Полный адрес для передачи наружу (в клиент MAX): относительный путь API там не поймут. */
export const absoluteApiUrl = (path: string): string =>
  new URL(path, base || window.location.origin).toString();

export const json = (data: unknown, method = 'POST'): RequestInit => ({
  method,
  body: JSON.stringify(data),
});

/** Файл с сервера (PDF): маршруты закрыты входом, поэтому обычная ссылка не подойдёт — только fetch с заголовком. */
export async function apiBlob(path: string): Promise<Blob> {
  if (useMock) {
    const { mockApi } = await import('./mock');
    return (await mockApi(path, {})) as Blob;
  }
  const headers = new Headers({ 'X-Init-Data': getInitData() });
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { headers });
  } catch {
    throw new ApiError('network', 'Нет связи с сервером', 0);
  }
  if (!res.ok) {
    const text = await res.text();
    let err: ApiErrorBody['error'] | undefined;
    try {
      err = (JSON.parse(text) as ApiErrorBody).error;
    } catch {}
    throw new ApiError(
      err?.code ?? 'http_error',
      err?.message ?? `Ошибка ${res.status}`,
      res.status,
    );
  }
  return res.blob();
}

/** Открывает скачанный файл: в вебе — новой вкладкой, в webview MAX — через скрытую ссылку с download. */
export function openBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (!opened) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
