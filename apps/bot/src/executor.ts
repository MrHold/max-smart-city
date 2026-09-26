import type { Bot } from '@maxhub/max-bot-api';
import {
  and,
  type Db,
  encryptUserId,
  enqueueNotification,
  eq,
  executors,
  houses,
  inArray,
  memberships,
  or,
  photos,
  processedUpdates,
  requestEvents,
  requests,
  sql,
  userHash,
  users,
  verifyInvite,
} from '@msc/db';
import { type RequestStatus, TransitionError, transition, type WorkflowEvent } from '@msc/domain';
import { nowFor } from './clock';
import { orderKeyboard } from './keyboards';
import { downloadImage, savePhoto } from './photo';

export type Deps = {
  db: Db;
  hashSecret: string;
  encKey: Buffer;
  demoMode: boolean;
  /** Папка с фото (та же, что у API). null — приём фото от исполнителя выключен. */
  photosDir: string | null;
};

const ACTIONS = {
  start: { event: 'start', eventType: 'started' },
  complete: { event: 'complete', eventType: 'completed' },
  decline: { event: 'decline', eventType: 'declined' },
} as const satisfies Record<string, { event: WorkflowEvent; eventType: string }>;
type ActionKey = keyof typeof ACTIONS;

// Где уже стоит заявка, если это же действие уже выполнено: повтор кнопки в таком случае молчит
const ALREADY_THERE: Record<ActionKey, string[]> = {
  start: ['in_progress', 'done', 'confirmed'],
  complete: ['done', 'confirmed'],
  decline: ['accepted'],
};

const PHOTO_WAIT_MS = 30 * 60_000; // после «Выполнено» полчаса ждём фото именно для этой заявки
const MAX_PHOTOS_PER_MESSAGE = 5;

type Outcome = {
  popup: string;
  reply?: string;
  keyboard?: ReturnType<typeof orderKeyboard>;
  /** Повтор уже выполненного действия: ничего не отвечаем, только снимаем «крутилку» с кнопки. */
  silent?: boolean;
};

const SILENT: Outcome = { popup: '', silent: true };

/** users.id по MAX user_id. create — завести пользователя, если его ещё нет (как при входе в API). */
async function userIdFor(deps: Deps, maxUserId: number, create: boolean): Promise<string | null> {
  const hash = userHash(maxUserId, deps.hashSecret);
  const find = async () => {
    const [row] = await deps.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.userHash, hash))
      .limit(1);
    return row?.id ?? null;
  };
  const existing = await find();
  if (existing || !create) return existing;
  await deps.db
    .insert(users)
    .values({ userHash: hash, userIdEnc: encryptUserId(maxUserId, deps.encKey) })
    .onConflictDoNothing({ target: users.userHash });
  return find();
}

/** Исполнитель, привязанный к этому пользователю MAX, и его users.id. */
async function executorFor(deps: Deps, maxUserId: number) {
  const userId = await userIdFor(deps, maxUserId, false);
  if (!userId) return null;
  const [executor] = await deps.db
    .select()
    .from(executors)
    .where(eq(executors.userId, userId))
    .limit(1);
  return executor ? { userId, executor } : null;
}

/** Привязка по приглашению: executors.user_id = этот пользователь MAX. */
async function bindExecutor(deps: Deps, maxUserId: number, token: string): Promise<string> {
  const executorId = verifyInvite(token, deps.hashSecret);
  if (!executorId)
    return 'Ссылка-приглашение недействительна. Попросите диспетчера прислать новую.';

  const [executor] = await deps.db
    .select()
    .from(executors)
    .where(eq(executors.id, executorId))
    .limit(1);
  if (!executor)
    return 'Исполнитель по этой ссылке не найден. Попросите диспетчера прислать новую.';

  const userId = await userIdFor(deps, maxUserId, true);
  if (!userId) return 'Не получилось сохранить привязку, попробуйте открыть ссылку ещё раз.';

  await deps.db.update(executors).set({ userId }).where(eq(executors.id, executorId));
  return `Готово, ${executor.nameShort}! Наряды по заявкам будут приходить сюда. Отмечайте ход работы кнопками под нарядом.`;
}

async function applyAction(
  deps: Deps,
  key: ActionKey,
  requestId: string,
  maxUserId: number,
  callbackId: string,
): Promise<Outcome> {
  const { db } = deps;
  const notLinked = {
    popup: 'Вы не привязаны как исполнитель. Откройте ссылку-приглашение от диспетчера.',
  };

  const found = await executorFor(deps, maxUserId);
  if (!found) return notLinked;
  const { userId, executor } = found;

  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) return { popup: 'Заявка не найдена.' };
  if (row.executorId !== executor.id) {
    // Сам только что нажал «Не могу» (executor_id уже обнулён), и второе нажатие догнало первое
    if (key === 'decline' && row.executorId === null) return SILENT;
    return { popup: 'Эта заявка назначена не вам.' };
  }

  let next: RequestStatus;
  try {
    next = transition(row.status as RequestStatus, ACTIONS[key].event);
  } catch (err) {
    if (!(err instanceof TransitionError)) throw err;
    // Заявка уже там, куда ведёт кнопка: это повтор того же действия — молчим
    if (ALREADY_THERE[key].includes(row.status)) return SILENT;
    return { popup: 'Заявка уже закрыта или изменена — ничего делать не нужно.' };
  }

  const now = await nowFor(db, deps.demoMode);
  const applied = await db.transaction(async (tx) => {
    // Повтор того же нажатия (или повторная доставка апдейта от MAX) — ничего не делаем
    const fresh = await tx
      .insert(processedUpdates)
      .values({ updateKey: `cb:${callbackId}` })
      .onConflictDoNothing()
      .returning({ key: processedUpdates.updateKey });
    if (fresh.length === 0) return false;

    const updated = await tx
      .update(requests)
      .set({
        status: next,
        updatedAt: now,
        ...(key === 'complete' ? { endedAt: now } : {}),
        ...(key === 'decline' ? { executorId: null } : {}),
      })
      // статус в условии: если диспетчер успел поменять заявку, ничего не перезаписываем
      .where(and(eq(requests.id, row.id), eq(requests.status, row.status)))
      .returning({ id: requests.id });
    if (updated.length === 0) return false;

    await tx.insert(requestEvents).values({
      requestId: row.id,
      type: ACTIONS[key].eventType,
      actorUserId: userId,
      payload: { by: 'executor', executorId: executor.id, nameShort: executor.nameShort },
      at: now,
    });

    const base = { requestId: row.id, number: row.number, nameShort: executor.nameShort };
    if (key === 'start')
      await enqueueNotification(tx, row.authorUserId, { type: 'in_progress', ...base });
    if (key === 'complete')
      await enqueueNotification(tx, row.authorUserId, { type: 'completed', ...base });
    if (key === 'decline') {
      // Отказ видит не житель, а диспетчеры дома: им назначать другого
      const [house] = await tx
        .select({ orgId: houses.orgId })
        .from(houses)
        .where(eq(houses.id, row.houseId))
        .limit(1);
      const dispatchers = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.role, 'dispatcher'),
            house?.orgId
              ? or(eq(memberships.orgId, house.orgId), eq(memberships.houseId, row.houseId))
              : eq(memberships.houseId, row.houseId),
          ),
        );
      for (const d of new Set(dispatchers.map((x) => x.userId))) {
        await enqueueNotification(tx, d, { type: 'executor_declined', ...base });
      }
    }
    return true;
  });

  // Повтор или заявку одновременно поменял диспетчер — первое нажатие уже всё сделало
  if (!applied) return SILENT;

  // Наряд заменится этим текстом — номер и суть заявки оставляем, чтобы было видно, о чём речь
  const header = `Заявка №${row.number}: ${row.description}`;
  if (key === 'start') {
    return {
      popup: 'Отметили: вы приступили.',
      reply: `${header}\n\nВы приступили к работе. Когда закончите — нажмите «Выполнено».`,
      keyboard: orderKeyboard(row.id, 'in_progress'),
    };
  }
  if (key === 'complete') {
    return {
      popup: 'Отметили: выполнено.',
      reply: `${header}\n\n✅ Выполнено. Житель получит уведомление и подтвердит работу.`,
    };
  }
  return {
    popup: 'Сняли вас с заявки.',
    reply: `${header}\n\nВы сняты с заявки. Диспетчер назначит другого исполнителя.`,
  };
}

/**
 * Фото результата от исполнителя → photos (stage = after) у заявки + уведомление жителю.
 * null — пользователь не исполнитель: пусть сообщение обработает общий обработчик.
 * '' — повторная доставка того же сообщения: молчим.
 */
async function savePhotosFromExecutor(
  deps: Deps,
  photosDir: string,
  maxUserId: number,
  mid: string,
  urls: string[],
  waitingFor: string | undefined,
): Promise<string | null> {
  const { db } = deps;
  const found = await executorFor(deps, maxUserId);
  if (!found) return null;
  const { userId, executor } = found;

  // К какой заявке: той, после «Выполнено» которой ждём фото; иначе — единственной текущей за сутки
  let requestId = waitingFor;
  if (!requestId) {
    const active = await db
      .select({ id: requests.id })
      .from(requests)
      .where(
        and(
          eq(requests.executorId, executor.id),
          inArray(requests.status, ['in_progress', 'done']),
          sql`${requests.updatedAt} > now() - interval '1 day'`,
        ),
      );
    if (active.length !== 1) {
      return 'Не понял, к какой заявке это фото. Нажмите «Выполнено» под нужным нарядом и пришлите фото следом.';
    }
    requestId = active[0]?.id;
  }

  const [row] = requestId
    ? await db.select().from(requests).where(eq(requests.id, requestId)).limit(1)
    : [];
  if (!row || row.executorId !== executor.id) return 'Эта заявка назначена не вам.';

  // Повторная доставка того же сообщения от MAX — второй раз не сохраняем
  const fresh = await db
    .insert(processedUpdates)
    .values({ updateKey: `msg:${mid}` })
    .onConflictDoNothing()
    .returning({ key: processedUpdates.updateKey });
  if (fresh.length === 0) return '';

  let saved = 0;
  try {
    for (const url of urls) {
      const { buffer, mime } = await downloadImage(url);
      const { key, sha256 } = await savePhoto(photosDir, buffer, mime);
      const [same] = await db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.requestId, row.id), eq(photos.storageKey, key)))
        .limit(1);
      if (same) continue; // это же фото уже прислали раньше
      await db
        .insert(photos)
        .values({ requestId: row.id, storageKey: key, sha256, stage: 'after', uploadedBy: userId });
      saved++;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'too_big') return 'Фото больше 5 МБ — пришлите поменьше.';
    if (message.startsWith('unsupported'))
      return 'Этот формат не подходит — пришлите фото (JPEG, PNG или WebP).';
    console.error('Фото от исполнителя не сохранилось:', err);
    return 'Не получилось сохранить фото, попробуйте отправить ещё раз.';
  }

  if (saved === 0) return 'Это фото уже есть в заявке.';
  await enqueueNotification(db, row.authorUserId, {
    type: 'photo_after',
    requestId: row.id,
    number: row.number,
    nameShort: executor.nameShort,
  });
  return `📷 Фото добавлено к заявке №${row.number} — житель увидит его в карточке.`;
}

/**
 * Исполнитель в боте. Регистрировать РАНЬШЕ общих обработчиков: иначе /start inv_… перехватит
 * обычное приветствие, а фото уйдёт в «Не понял сообщение».
 */
export function registerExecutor(bot: Bot, deps: Deps): void {
  // Кому бот сейчас ждёт фото результата: MAX user_id → заявка и до какого времени
  const awaitingPhoto = new Map<number, { requestId: string; until: number }>();

  // Открыл ссылку max.ru/<бот>?start=inv_… — MAX присылает bot_started с этим payload
  bot.on('bot_started', async (ctx, next) => {
    const payload = ctx.startPayload;
    const maxUserId = ctx.user?.user_id;
    if (typeof payload !== 'string' || !payload.startsWith('inv_') || !maxUserId) return next();
    await ctx.reply(await bindExecutor(deps, maxUserId, payload));
  });

  // Запасной путь: прислал «/start inv_…» или просто код приглашения текстом
  bot.hears(/^(?:\/start\s+)?(inv_[A-Za-z0-9_-]+)$/, async (ctx) => {
    const token = ctx.match?.[1];
    const maxUserId = ctx.message?.sender?.user_id;
    if (!token || !maxUserId) return;
    await ctx.reply(await bindExecutor(deps, maxUserId, token));
  });

  // Фото в чате: если прислал исполнитель — это фото результата
  bot.on('message_created', async (ctx, next) => {
    const urls: string[] = [];
    for (const a of ctx.message?.body?.attachments ?? []) {
      if (a.type === 'image') urls.push(a.payload.url);
    }
    const maxUserId = ctx.message?.sender?.user_id;
    const mid = ctx.message?.body?.mid;
    if (urls.length === 0 || !maxUserId || !mid || !deps.photosDir) return next();

    const waiting = awaitingPhoto.get(maxUserId);
    const waitingFor = waiting && waiting.until > Date.now() ? waiting.requestId : undefined;
    const text = await savePhotosFromExecutor(
      deps,
      deps.photosDir,
      maxUserId,
      mid,
      urls.slice(0, MAX_PHOTOS_PER_MESSAGE),
      waitingFor,
    );
    if (text === null) return next(); // не исполнитель — ответит общий обработчик
    if (text) await ctx.reply(text);
  });

  // Кнопки под нарядом: exe:start|complete|decline:<id заявки>
  bot.action(/^exe:(start|complete|decline):(.+)$/, async (ctx) => {
    const key = ctx.match?.[1] as ActionKey | undefined;
    const requestId = ctx.match?.[2];
    const maxUserId = ctx.user?.user_id;
    const callbackId = ctx.callback?.callback_id;
    if (!key || !requestId || !maxUserId || !callbackId) return;

    const outcome = await applyAction(deps, key, requestId, maxUserId, callbackId);

    if (outcome.silent) {
      // Повтор: только снимаем «крутилку» с кнопки, наряд и чат не трогаем
      await ctx.answerOnCallback({}).catch(() => {});
      return;
    }

    if (outcome.reply) {
      // Успех: наряд заменяется новым состоянием; после «Выполнено» и «Не могу» кнопок больше нет
      const attachments = outcome.keyboard ? [outcome.keyboard] : [];
      await ctx
        .answerOnCallback({ message: { text: outcome.reply, attachments } })
        .catch(() => ctx.reply(outcome.reply ?? '', { attachments }));

      if (key === 'complete' && deps.photosDir) {
        awaitingPhoto.set(maxUserId, { requestId, until: Date.now() + PHOTO_WAIT_MS });
        await ctx.reply(
          '📷 Пришлите фото результата — житель увидит его в заявке. Если фото нет, ничего делать не нужно.',
        );
      }
    } else {
      // Отказ (не ваша заявка, уже закрыта): наряд не трогаем, объясняем отдельным сообщением
      await ctx.answerOnCallback({}).catch(() => {});
      await ctx.reply(outcome.popup);
    }
  });
}

/** Имя исполнителя, если этот пользователь MAX к нему привязан, иначе null. */
export async function executorNameFor(deps: Deps, maxUserId: number): Promise<string | null> {
  const found = await executorFor(deps, maxUserId);
  return found?.executor.nameShort ?? null;
}
