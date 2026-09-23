import { Button } from '../ui';
import { DAY, HOUR, isDemoMode, setDemoOffset, shiftDemoClock, useDemoOffset } from './index';

function formatOffset(ms: number): string {
  if (ms === 0) return 'реальное время';
  const h = Math.round(ms / HOUR);
  const d = Math.floor(h / 24);
  const rest = h % 24;
  const parts = [];
  if (d) parts.push(`${d} д`);
  if (rest) parts.push(`${rest} ч`);
  return `+${parts.join(' ')}`;
}

export function DemoClockControl() {
  const offset = useDemoOffset();
  if (!isDemoMode) return null;
  return (
    <div className="demo-clock">
      <div className="row row--between">
        <div className="eyebrow">Демо-часы</div>
        <span className="muted num">{formatOffset(offset)}</span>
      </div>
      <div className="demo-clock__row">
        <Button size="sm" variant="secondary" onClick={() => shiftDemoClock(HOUR)}>
          +1 ч
        </Button>
        <Button size="sm" variant="secondary" onClick={() => shiftDemoClock(DAY)}>
          +1 день
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDemoOffset(0)}>
          сброс
        </Button>
      </div>
      <div className="hint">
        Сдвигает время только в этом окне. Серверный сдвиг — через демо-режим API.
      </div>
    </div>
  );
}
