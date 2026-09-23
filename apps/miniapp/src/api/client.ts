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

export const json = (data: unknown, method = 'POST'): RequestInit => ({
  method,
  body: JSON.stringify(data),
});
