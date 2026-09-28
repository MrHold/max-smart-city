import { useEffect, useRef } from 'react';
import { ensureWebApp } from './index';

/**
 * Кнопка «Назад» в шапке MAX: в webview нет системного возврата, поэтому экраны без таббара
 * показывают её сами. Обработчик берётся из ref, чтобы не перевешивать его на каждый рендер.
 */
export function useBackButton(onBack: (() => void) | null) {
  const ref = useRef(onBack);
  ref.current = onBack;
  const enabled = onBack !== null;
  useEffect(() => {
    const bb = ensureWebApp().BackButton;
    if (!bb || !enabled) return;
    const handler = () => ref.current?.();
    bb.show();
    bb.onClick(handler);
    return () => {
      bb.offClick?.(handler);
      bb.hide();
    };
  }, [enabled]);
}
