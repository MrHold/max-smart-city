import type { Clock } from '@msc/domain';
import { useSyncExternalStore } from 'react';

/**
 * Сдвиг демо-часов приходит с сервера (GET /api/demo/clock) и хранится здесь,
 * чтобы обратные отсчёты на экранах считались по тому же времени, что сроки и суммы в API.
 */
const listeners = new Set<() => void>();
let offsetMs = 0;

function emit() {
  for (const l of listeners) l();
}

export const demoClock: Clock = {
  now: () => new Date(Date.now() + offsetMs),
};

export function applyDemoOffset(ms: number) {
  if (ms === offsetMs) return;
  offsetMs = ms;
  emit();
}

export function useDemoOffset(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => offsetMs,
    () => 0,
  );
}

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === '1';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
