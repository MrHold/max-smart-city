import type { Clock } from '@msc/domain';
import { useSyncExternalStore } from 'react';

const KEY = 'msc.demoClockOffsetMs';
const listeners = new Set<() => void>();

function readOffset(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

let offsetMs = readOffset();

function emit() {
  for (const l of listeners) l();
}

export const demoClock: Clock = {
  now: () => new Date(Date.now() + offsetMs),
};

export function setDemoOffset(ms: number) {
  offsetMs = ms;
  try {
    localStorage.setItem(KEY, String(ms));
  } catch {}
  emit();
}

export function shiftDemoClock(deltaMs: number) {
  setDemoOffset(offsetMs + deltaMs);
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
