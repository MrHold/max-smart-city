import { type Bot, Keyboard } from '@maxhub/max-bot-api';
import { and, asc, type Db, decryptUserId, eq, outbox, sql, users } from '@msc/db';

const TICK_MS = 5_000; // как часто проверять очередь
const BATCH = 25; // сколько сообщений за один проход
const GAP_MS = 40; // пауза между сообщениями: не больше 25 в секунду (лимит MAX — 30)
const MAX_ATTEMPTS = 8; // после стольких неудач — status = failed, больше не пытаемся

type Payload = { type?: string; requestId?: string; number?: string; [key: string]: unknown };

const formatDate = (iso: unknown): string | null => {
  if (typeof iso !== 'string') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** Текст уведомления по payload, который API кладёт в outbox. */
export function notificationText(p: Payload): string {
  const no = p.number ? `№${p.number}` : '';
  switch (p.type) {
    case 'joined':
      return `К заявке ${no} присоединились соседи: кв. ${p.apartmentLabel ?? '—'}. УК увидит масштаб проблемы.`;
    case 'accepted':
      return `Заявка ${no} принята управляющей компанией.`;
    case 'rejected':
      return `Заявка ${no} отклонена. Причина: ${p.reason ?? 'не указана'}.`;
    case 'assigned': {
      const when = formatDate(p.plannedAt);
      const name = typeof p.nameShort === 'string' ? p.nameShort : '';
      // «Иванов И.» уже кончается точкой — вторую не ставим
      const who = name ? `: ${name}${name.endsWith('.') ? '' : '.'}` : '.';
      return `По заявке ${no} назначен исполнитель${who}${when ? ` Плановое время — ${when}.` : ''}`;
    }
    case 'completed':
      return `Работа по заявке ${no} выполнена. Проверьте результат и подтвердите в приложении.`;
    default:
      return `Заявка ${no} обновлена. Подробности — в приложении.`;
  }
}

type Row = { id: number; payload: unknown; attempts: number; userIdEnc: string | null };

/**
 * Почтальон: раз в TICK_MS забирает из outbox неотправленные уведомления и шлёт их в MAX.
 * Ошибка отправки не теряет сообщение: попытка повторится позже (30 с, 1 мин, 2 мин … до 1 ч).
 */
export function startOutbox(deps: {
  bot: Bot;
  db: Db;
  encKey: Buffer;
  botUsername: string;
  botId: number;
}): () => void {
  const { bot, db, encKey, botUsername, botId } = deps;
  let busy = false;

  async function deliver(row: Row): Promise<void> {
    try {
      if (!row.userIdEnc) throw new Error('у пользователя нет user_id_enc');
      const payload = (row.payload ?? {}) as Payload;
      const maxUserId = decryptUserId(row.userIdEnc, encKey);

      // Кнопка открывает мини-приложение сразу на этой заявке (тот же формат, что у ссылки «Поделиться»)
      const button = payload.requestId
        ? Keyboard.button.openApp('Открыть заявку', botUsername, botId, `r_${payload.requestId}`)
        : Keyboard.button.openApp('Мой дом', botUsername, botId);

      await bot.api.sendMessageToUser(maxUserId, notificationText(payload), {
        attachments: [Keyboard.inlineKeyboard([[button]])],
      });
      await db
        .update(outbox)
        .set({ status: 'sent', sentAt: new Date(), lastError: null })
        .where(eq(outbox.id, row.id));
    } catch (err) {
      const attempts = row.attempts + 1;
      const delaySec = Math.min(30 * 2 ** (attempts - 1), 3600);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`outbox #${row.id}: попытка ${attempts} не удалась — ${message}`);
      await db
        .update(outbox)
        .set({
          attempts,
          lastError: message.slice(0, 500),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          nextAt: sql`now() + make_interval(secs => ${delaySec})`,
        })
        .where(eq(outbox.id, row.id));
    }
  }

  async function tick(): Promise<void> {
    if (busy) return; // прошлый проход ещё идёт — не запускаем второй параллельно
    busy = true;
    try {
      const rows = await db
        .select({
          id: outbox.id,
          payload: outbox.payload,
          attempts: outbox.attempts,
          userIdEnc: users.userIdEnc,
        })
        .from(outbox)
        .innerJoin(users, eq(users.id, outbox.userId))
        .where(and(eq(outbox.status, 'pending'), sql`${outbox.nextAt} <= now()`))
        .orderBy(asc(outbox.id))
        .limit(BATCH);

      for (const row of rows) {
        await deliver(row);
        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      }
    } catch (err) {
      console.error('outbox: ошибка при чтении очереди', err);
    } finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), TICK_MS);
  void tick();
  return () => clearInterval(timer);
}
