import type { Bot } from '@maxhub/max-bot-api';

const WINDOW_MS = 3_000; // повтор той же кнопки быстрее этого — случайный двойной тап

/**
 * Повторное нажатие той же кнопки тем же человеком в течение WINDOW_MS тихо игнорируется:
 * снимаем «крутилку» с кнопки и ничего не отвечаем. Регистрировать ПЕРВЫМ обработчиком —
 * до всех bot.action(), иначе повтор успеет дойти до них.
 */
export function ignoreRepeatedTaps(bot: Bot): void {
  const lastTap = new Map<string, number>();

  bot.on('message_callback', async (ctx, next) => {
    const userId = ctx.user?.user_id;
    const payload = ctx.callback?.payload;
    if (!userId || !payload) return next();

    const key = `${userId}:${payload}`;
    const now = Date.now();
    const previous = lastTap.get(key);
    lastTap.set(key, now);

    // Старые записи чистим, чтобы память не росла
    if (lastTap.size > 1_000) {
      for (const [k, at] of lastTap) if (now - at > WINDOW_MS) lastTap.delete(k);
    }

    if (previous !== undefined && now - previous < WINDOW_MS) {
      await ctx.answerOnCallback({}).catch(() => {});
      return;
    }
    return next();
  });
}
