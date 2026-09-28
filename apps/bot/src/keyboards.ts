import { Keyboard } from '@maxhub/max-bot-api';

/** Кнопки под нарядом. После «Принял» кнопка «Принял» больше не нужна. */
export function orderKeyboard(requestId: string, stage: 'assigned' | 'in_progress') {
  const accept = Keyboard.button.callback('Принял', `exe:start:${requestId}`);
  const done = Keyboard.button.callback('Выполнено', `exe:complete:${requestId}`);
  const cannot = Keyboard.button.callback('Не могу', `exe:decline:${requestId}`);
  return Keyboard.inlineKeyboard(
    stage === 'assigned' ? [[accept], [done], [cannot]] : [[done], [cannot]],
  );
}

/**
 * Режим фото после «Выполнено»: завершить заявку или вернуться к наряду.
 * Стоит только под последним сообщением бота — со старых сообщений кнопки снимаются.
 */
export function photoModeKeyboard(requestId: string) {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.callback('✅ Завершить заявку', `exe:finish:${requestId}`)],
    [Keyboard.button.callback('↩️ Назад', `exe:back:${requestId}`)],
  ]);
}
