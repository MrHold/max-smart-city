import { useEffect } from 'react';
import { useDemoClock, useShiftDemoClock } from '../api/hooks';
import { Button } from '../ui';
import { applyDemoOffset, isDemoMode, useDemoOffset } from './index';

/** Держит локальный сдвиг равным серверному. Монтируется один раз в App. */
export function DemoClockSync() {
  const q = useDemoClock();
  useEffect(() => {
    if (q.data) applyDemoOffset(q.data.offsetMs);
  }, [q.data]);
  return null;
}

/** Плашка на всех экранах, пока время перемотано: чтобы сдвинутые сроки не приняли за настоящие. */
export function DemoClockBadge() {
  const offset = useDemoOffset();
  const q = useDemoClock();
  if (!isDemoMode || offset === 0) return null;
  return (
    <div className="demo-badge" role="status">
      Демо-время: {q.data?.label ?? ''}
    </div>
  );
}

export function DemoClockControl() {
  const q = useDemoClock();
  const shift = useShiftDemoClock();
  if (!isDemoMode) return null;
  const label = q.isError ? 'недоступны' : (q.data?.label ?? '…');
  return (
    <div className="demo-clock">
      <div className="row row--between">
        <div className="eyebrow">Демо-часы</div>
        <span className="muted num">{label}</span>
      </div>
      <div className="demo-clock__row">
        <Button
          size="sm"
          variant="secondary"
          loading={shift.isPending}
          onClick={() => shift.mutate({ shiftHours: 1 })}
        >
          +1 ч
        </Button>
        <Button
          size="sm"
          variant="secondary"
          loading={shift.isPending}
          onClick={() => shift.mutate({ shiftHours: 24 })}
        >
          +1 день
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={shift.isPending}
          onClick={() => shift.mutate({ reset: true })}
        >
          сброс
        </Button>
      </div>
      <div className="hint">
        Сдвиг общий для всех: сроки, просрочка, сумма перерасчёта и шаг «жалоба в ГЖИ» считаются по
        перемотанному времени. Работает только в демо-режиме сервера.
      </div>
      {shift.isError && <div className="field__error">{shift.error.message}</div>}
    </div>
  );
}
