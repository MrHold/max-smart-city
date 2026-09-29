import { useEffect, useState } from 'react';
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

/** Плашка на всех экранах: показывает сдвиг времени и по нажатию раскрывает управление,
 * чтобы на защите не ходить в профиль после каждого шага. */
export function DemoClockBadge() {
  const offset = useDemoOffset();
  const q = useDemoClock();
  const [open, setOpen] = useState(false);
  if (!isDemoMode) return null;
  return (
    <>
      <button
        type="button"
        className="demo-badge"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {offset === 0 ? 'Демо-часы' : `Демо-время: ${q.data?.label ?? ''}`}
      </button>
      {open && (
        <div className="demo-popover">
          <DemoClockControl />
        </div>
      )}
    </>
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
      {shift.isError && (
        <div className="field__error" role="alert">
          {shift.error.message}
        </div>
      )}
    </div>
  );
}
