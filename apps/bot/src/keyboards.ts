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
