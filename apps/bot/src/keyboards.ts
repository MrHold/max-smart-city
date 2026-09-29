import { Keyboard } from '@maxhub/max-bot-api';

export type OrderStage = 'assigned' | 'in_progress';

/** Кнопки под нарядом по шагам: сначала «Принял», и только потом «Выполнено». */
export function orderKeyboard(requestId: string, stage: OrderStage) {
  const accept = Keyboard.button.callback('▶️ Принял', `exe:start:${requestId}`);
  const done = Keyboard.button.callback('✅ Выполнено', `exe:complete:${requestId}`);
  const cannot = Keyboard.button.callback('Не могу', `exe:decline:${requestId}`);
  return Keyboard.inlineKeyboard(stage === 'assigned' ? [[accept], [cannot]] : [[done], [cannot]]);
}

/** «Мои наряды»: по кнопке на наряд — открыть его карточку заново. */
export function ordersListKeyboard(items: Array<{ requestId: string; label: string }>) {
  return Keyboard.inlineKeyboard(
    items.map((i) => [Keyboard.button.callback(i.label, `exe:show:${i.requestId}`)]),
  );
}

/**
 * Режим фото после «Выполнено»: завершить заявку или вернуться к наряду.
 * Стоит только под последним сообщением бота — со старых сообщений кнопки снимаются.
 */
export function photoModeKeyboard(requestId: string, photos = 0) {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('✅ Завершить заявку', `exe:finish:${requestId}`)],
    ...(photos > 0
      ? [[Keyboard.button.callback('🗑 Удалить последнее фото', `exe:undo:${requestId}`)]]
      : []),
    [Keyboard.button.callback('↩️ Назад', `exe:back:${requestId}`)],
  ]);
}
