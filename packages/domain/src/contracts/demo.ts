import * as z from 'zod';
import { IsoDateTime } from './common';

/**
 * Демо-часы. Нужны на защите: ждать два часа, пока истечёт срок и откроется жалоба
 * в ГЖИ, никто не будет. Сдвиг общий для всех процессов и виден в интерфейсе,
 * чтобы никто не принял перемотанное время за настоящее.
 */
export const DemoClockStateSchema = z.object({
  now: IsoDateTime,
  /** На сколько миллисекунд время сдвинуто вперёд относительно настоящего. */
  offsetMs: z.int(),
  /** Человекочитаемый сдвиг: «+6 ч» или «реальное время». */
  label: z.string(),
});
export type DemoClockState = z.infer<typeof DemoClockStateSchema>;

export const DemoClockInputSchema = z.union([
  z.object({ shiftHours: z.number().min(-720).max(720) }),
  z.object({ offsetMs: z.int().min(-2_592_000_000).max(2_592_000_000) }),
  z.object({ reset: z.literal(true) }),
]);
export type DemoClockInput = z.infer<typeof DemoClockInputSchema>;

export function demoClockLabel(offsetMs: number): string {
  if (offsetMs === 0) return 'реальное время';
  const hours = offsetMs / 3_600_000;
  const rounded = Math.round(hours * 10) / 10;
  const sign = rounded > 0 ? '+' : '−';
  const abs = Math.abs(rounded);
  return abs >= 24 ? `${sign}${Math.round((abs / 24) * 10) / 10} сут` : `${sign}${abs} ч`;
}
