import { type Bot, Keyboard } from '@maxhub/max-bot-api';
import { and, asc, type Db, decryptUserId, eq, outbox, sql, users } from '@msc/db';
import { orderKeyboard } from './keyboards';

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

// Названия категорий для наряда (коды — из regions/16-tatarstan/categories.yaml).
// Незнакомый код покажем как есть, пока API не начнёт класть название в payload.
const CATEGORY_TITLES: Record<string, string> = {
  heating: 'Холодные батареи',
  heating_off: 'Нет отопления',
  hot_water: 'Горячая вода холодная',
  hot_water_off: 'Нет горячей воды',
  cold_water_off: 'Нет холодной воды',
  yard_lighting: 'Освещение во дворе',
  yard_cleaning: 'Уборка, мусор',
  playground: 'Детская площадка',
  entrance_light: 'Не горит свет в подъезде',
  entrance_door: 'Дверь, домофон',
  elevator: 'Лифт',
  entrance_cleaning: 'Не убран подъезд',
};
const categoryTitle = (code: unknown): string | null =>
  typeof code === 'string' ? (CATEGORY_TITLES[code] ?? code) : null;

/**
 * Убирает user_id из текста ошибки перед записью в базу и лог.
 * Библиотека может вставить адрес запроса (…?user_id=123) или сам номер в сообщение,
 * а user_id в открытом виде мы не храним — в users он только зашифрован.
 */
export function maskUserId(text: string, userId: number | null): string {
  let out = text.replace(/(user_?id["'=:\s]*)\d+/gi, '$1***');
  if (userId !== null) out = out.split(String(userId)).join('***');
  return out;
}

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
    case 'completed': {
      const n = typeof p.photos === 'number' ? p.photos : 0;
      return `Работа по заявке ${no} выполнена${n ? `, исполнитель приложил фото: ${n}` : ''}. Проверьте результат и подтвердите в приложении.`;
    }
    case 'order': {
      const when = formatDate(p.plannedAt);
      const what = categoryTitle(p.categoryTitle ?? p.category);
      const lines = [
        `🛠 Наряд по заявке ${no}`,
        p.address ? `Адрес: ${p.address}` : null,
        what ? `Что: ${what}` : null,
        typeof p.description === 'string' && p.description ? `Описание: ${p.description}` : null,
        when ? `Плановое время: ${when}` : null,
        '',
        'Отметьте кнопками, когда приступите и когда закончите.',
      ];
      return lines.filter((line) => line !== null).join('\n');
    }
    case 'auto_closed':
      return `Заявка ${no} закрыта автоматически: вы не подтвердили результат в течение ${p.afterDays ?? 3} суток. Если проблема осталась, подайте новую заявку.`;
    case 'in_progress':
      return `Исполнитель${p.nameShort ? ` ${p.nameShort}` : ''} приступил к работе по заявке ${no}.`;
    case 'executor_declined':
      return `Исполнитель${p.nameShort ? ` ${p.nameShort}` : ''} отказался от заявки ${no}. Назначьте другого в кабинете диспетчера.`;
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
    // Адресат удалил свои данные (user_id_enc стёрт) — отправлять некому, повторы бессмысленны
    if (!row.userIdEnc) {
      await db
        .update(outbox)
        .set({ status: 'failed', lastError: 'адресат удалил свои данные' })
        .where(eq(outbox.id, row.id));
      return;
    }

    // Объявлен до try: в catch он нужен, чтобы вычистить номер из текста ошибки
    let maxUserId: number | null = null;
    try {
      const payload = (row.payload ?? {}) as Payload;
      maxUserId = decryptUserId(row.userIdEnc, encKey);

      // Наряду — кнопки исполнителя; остальным — открыть заявку в мини-приложении
      const keyboard =
        payload.type === 'order' && payload.requestId
          ? orderKeyboard(payload.requestId, 'assigned')
          : Keyboard.inlineKeyboard([
              [
                payload.requestId
                  ? Keyboard.button.openApp(
                      'Открыть заявку',
                      botUsername,
                      botId,
                      `req_${payload.requestId}`,
                    )
                  : Keyboard.button.openApp('Мой дом', botUsername, botId),
              ],
            ]);

      await bot.api.sendMessageToUser(maxUserId, notificationText(payload), {
        attachments: [keyboard],
      });
      await db
        .update(outbox)
        .set({ status: 'sent', sentAt: new Date(), lastError: null })
        .where(eq(outbox.id, row.id));
    } catch (err) {
      const attempts = row.attempts + 1;
      const delaySec = Math.min(30 * 2 ** (attempts - 1), 3600);
      const raw = err instanceof Error ? err.message : String(err);
      const message = maskUserId(raw, maxUserId);
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
