import type { Bot } from '@maxhub/max-bot-api';
import {
  and,
  type Db,
  type DbOrTx,
  encryptUserId,
  enqueueNotification,
  eq,
  executors,
  houses,
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
import {
  canTransition,
  type RequestStatus,
  TransitionError,
  transition,
  type WorkflowEvent,
} from '@msc/domain';
import { nowFor } from './clock';
import { finishKeyboard, orderKeyboard, photoModeKeyboard } from './keyboards';
import { downloadImage, savePhoto } from './photo';

export type Deps = {
  db: Db;
  hashSecret: string;
  encKey: Buffer;
  demoMode: boolean;
  /** Папка с фото (та же, что у API). null — режима фото нет, «Выполнено» сразу завершает заявку. */
  photosDir: string | null;
};

// Действия, которые меняют статус заявки. «Выполнено» статус не меняет — оно открывает режим фото,
// а заявку завершает кнопка «Завершить заявку» (finish).
const ACTIONS = {
  start: { event: 'start', eventType: 'started' },
  finish: { event: 'complete', eventType: 'completed' },
  decline: { event: 'decline', eventType: 'declined' },
} as const satisfies Record<string, { event: WorkflowEvent; eventType: string }>;
type ActionKey = keyof typeof ACTIONS;

// Где уже стоит заявка, если это же действие уже выполнено: повтор кнопки в таком случае молчит
const ALREADY_THERE: Record<ActionKey, string[]> = {
  start: ['in_progress', 'done', 'confirmed'],
  finish: ['done', 'confirmed'],
  decline: ['accepted'],
};

const PHOTO_SESSION_MS = 6 * 60 * 60_000; // режим фото закрывается сам, если про него забыли
const MAX_PHOTOS_PER_MESSAGE = 5;
const MAX_PHOTOS_PER_REQUEST = 10;

type Kb = ReturnType<typeof orderKeyboard>;
type Outcome = {
  popup: string;
  reply?: string;
  keyboard?: Kb;
  /** Повтор уже выполненного действия: ничего не отвечаем, только снимаем «крутилку» с кнопки. */
  silent?: boolean;
  /** Номер заявки — нужен режиму фото для подсказок. */
  number?: string;
};

const SILENT: Outcome = { popup: '', silent: true };
const NOT_LINKED: Outcome = {
  popup: 'Вы не привязаны как исполнитель. Откройте ссылку-приглашение от диспетчера.',
};

/** Режим фото: исполнитель прикладывает фото к этой заявке, пока не нажмёт «Завершить» или «Назад». */
type PhotoSession = { requestId: string; number: string; until: number };

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

/** Сколько фото «после» уже приложено к заявке. Считаем по базе — переживает перезапуск бота. */
async function afterPhotos(db: DbOrTx, requestId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(photos)
    .where(and(eq(photos.requestId, requestId), eq(photos.stage, 'after')));
  return row?.n ?? 0;
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

/** «Принял» / «Завершить заявку» / «Не могу» — смена статуса одной транзакцией. */
async function applyAction(
  deps: Deps,
  key: ActionKey,
  requestId: string,
  maxUserId: number,
  callbackId: string,
): Promise<Outcome> {
  const { db } = deps;
  const found = await executorFor(deps, maxUserId);
  if (!found) return NOT_LINKED;
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
    if (fresh.length === 0) return null;

    const updated = await tx
      .update(requests)
      .set({
        status: next,
        updatedAt: now,
        ...(key === 'finish' ? { endedAt: now } : {}),
        ...(key === 'decline' ? { executorId: null } : {}),
      })
      // статус в условии: если диспетчер успел поменять заявку, ничего не перезаписываем
      .where(and(eq(requests.id, row.id), eq(requests.status, row.status)))
      .returning({ id: requests.id });
    if (updated.length === 0) return null;

    const photoCount = key === 'finish' ? await afterPhotos(tx, row.id) : 0;

    await tx.insert(requestEvents).values({
      requestId: row.id,
      type: ACTIONS[key].eventType,
      actorUserId: userId,
      payload: {
        by: 'executor',
        executorId: executor.id,
        nameShort: executor.nameShort,
        ...(key === 'finish' ? { photos: photoCount } : {}),
      },
      at: now,
    });

    const base = { requestId: row.id, number: row.number, nameShort: executor.nameShort };
    if (key === 'start')
      await enqueueNotification(tx, row.authorUserId, { type: 'in_progress', ...base });
    if (key === 'finish')
      await enqueueNotification(tx, row.authorUserId, {
        type: 'completed',
        ...base,
        photos: photoCount,
      });
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
    return { photoCount };
  });

  // Повтор или заявку одновременно поменял диспетчер — первое нажатие уже всё сделало
  if (!applied) return SILENT;

  // Сообщение с кнопкой заменится этим текстом — номер и суть заявки оставляем
  const header = `Заявка №${row.number}: ${row.description}`;
  if (key === 'start') {
    return {
      popup: '',
      reply: `${header}\n\nВы приступили к работе. Когда закончите — нажмите «Выполнено».`,
      keyboard: orderKeyboard(row.id, 'in_progress'),
    };
  }
  if (key === 'finish') {
    const n = applied.photoCount;
    return {
      popup: '',
      reply: `${header}\n\n✅ Заявка завершена${n ? `, приложено фото: ${n}` : ' без фото'}. Житель получит уведомление и подтвердит работу.`,
    };
  }
  return {
    popup: '',
    reply: `${header}\n\nВы сняты с заявки. Диспетчер назначит другого исполнителя.`,
  };
}

/** «Выполнено»: открыть режим фото. Статус заявки не меняется. */
async function enterPhotoMode(deps: Deps, requestId: string, maxUserId: number): Promise<Outcome> {
  const found = await executorFor(deps, maxUserId);
  if (!found) return NOT_LINKED;
  const [row] = await deps.db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) return { popup: 'Заявка не найдена.' };
  if (row.executorId !== found.executor.id) return { popup: 'Эта заявка назначена не вам.' };
  if (!canTransition(row.status as RequestStatus, 'complete')) {
    if (ALREADY_THERE.finish.includes(row.status)) return SILENT;
    return { popup: 'Заявка уже закрыта или изменена — ничего делать не нужно.' };
  }

  const already = await afterPhotos(deps.db, row.id);
  return {
    popup: '',
    number: row.number,
    reply:
      `Заявка №${row.number}: ${row.description}\n\n` +
      '📷 Пришлите фото результата — одно или несколько. Когда закончите, нажмите «Завершить заявку».' +
      (already ? `\nУже приложено фото: ${already}.` : ''),
    keyboard: photoModeKeyboard(row.id),
  };
}

/** «Назад» из режима фото: наряд снова с кнопками «Выполнено» / «Не могу». */
async function backToOrder(deps: Deps, requestId: string, maxUserId: number): Promise<Outcome> {
  const found = await executorFor(deps, maxUserId);
  if (!found) return NOT_LINKED;
  const [row] = await deps.db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row || row.executorId !== found.executor.id) return SILENT;
  if (!canTransition(row.status as RequestStatus, 'complete')) return SILENT; // уже завершена
  return {
    popup: '',
    reply: `Заявка №${row.number}: ${row.description}\n\nЗаявка остаётся в работе. Когда закончите — нажмите «Выполнено».`,
    keyboard: orderKeyboard(row.id, row.status === 'assigned' ? 'assigned' : 'in_progress'),
  };
}

/**
 * Фото в режиме фото → photos (stage = after) у заявки.
 * text '' — повторная доставка того же сообщения от MAX: молчим.
 * keepSession false — заявка уже закрыта, режим фото больше не нужен.
 */
async function savePhotos(
  deps: Deps,
  photosDir: string,
  maxUserId: number,
  mid: string,
  urls: string[],
  requestId: string,
): Promise<{ text: string; keepSession: boolean }> {
  const { db } = deps;
  const found = await executorFor(deps, maxUserId);
  if (!found) return { text: NOT_LINKED.popup, keepSession: false };

  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row || row.executorId !== found.executor.id)
    return { text: 'Эта заявка назначена не вам.', keepSession: false };
  if (!canTransition(row.status as RequestStatus, 'complete'))
    return {
      text: `Заявка №${row.number} уже закрыта — фото к ней не добавить.`,
      keepSession: false,
    };

  // Повторная доставка того же сообщения от MAX — второй раз не сохраняем
  const fresh = await db
    .insert(processedUpdates)
    .values({ updateKey: `msg:${mid}` })
    .onConflictDoNothing()
    .returning({ key: processedUpdates.updateKey });
  if (fresh.length === 0) return { text: '', keepSession: true };

  const before = await afterPhotos(db, row.id);
  if (before >= MAX_PHOTOS_PER_REQUEST) {
    return {
      text: `К заявке уже приложено ${MAX_PHOTOS_PER_REQUEST} фото — этого достаточно. Нажмите «Завершить заявку».`,
      keepSession: true,
    };
  }

  let added = 0;
  try {
    for (const url of urls.slice(0, MAX_PHOTOS_PER_REQUEST - before)) {
      const { buffer, mime } = await downloadImage(url);
      const { key, sha256 } = await savePhoto(photosDir, buffer, mime);
      const [same] = await db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.requestId, row.id), eq(photos.storageKey, key)))
        .limit(1);
      if (same) continue; // это же фото уже прислали раньше
      await db.insert(photos).values({
        requestId: row.id,
        storageKey: key,
        sha256,
        stage: 'after',
        uploadedBy: found.userId,
      });
      added++;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message === 'too_big')
      return { text: 'Фото больше 5 МБ — пришлите поменьше.', keepSession: true };
    if (message.startsWith('unsupported'))
      return {
        text: 'Этот формат не подходит — пришлите фото (JPEG, PNG или WebP).',
        keepSession: true,
      };
    console.error('Фото от исполнителя не сохранилось:', err);
    return {
      text: 'Не получилось сохранить фото, попробуйте отправить ещё раз.',
      keepSession: true,
    };
  }

  const total = await afterPhotos(db, row.id);
  return {
    text: added
      ? `📷 Фото добавлено (всего: ${total}). Пришлите ещё или нажмите «Завершить заявку».`
      : 'Это фото уже есть в заявке. Пришлите другое или нажмите «Завершить заявку».',
    keepSession: true,
  };
}

/**
 * Исполнитель в боте. Регистрировать РАНЬШЕ общих обработчиков: иначе /start inv_… перехватит
 * обычное приветствие, а сообщения в режиме фото — «Не понял сообщение».
 */
export function registerExecutor(bot: Bot, deps: Deps): void {
  // Кто сейчас в режиме фото: MAX user_id → заявка. Один режим на исполнителя.
  const sessions = new Map<number, PhotoSession>();
  const activeSession = (maxUserId: number): PhotoSession | undefined => {
    const s = sessions.get(maxUserId);
    if (s && s.until > Date.now()) return s;
    sessions.delete(maxUserId);
    return undefined;
  };
  const closeSession = (maxUserId: number, requestId: string) => {
    if (sessions.get(maxUserId)?.requestId === requestId) sessions.delete(maxUserId);
  };

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

  // Сообщения исполнителя в режиме фото: фото — к заявке, текст — подсказка
  bot.on('message_created', async (ctx, next) => {
    const maxUserId = ctx.message?.sender?.user_id;
    if (!maxUserId) return next();

    const urls: string[] = [];
    for (const a of ctx.message?.body?.attachments ?? []) {
      if (a.type === 'image') urls.push(a.payload.url);
    }
    const text = ctx.message?.body?.text ?? '';
    const session = activeSession(maxUserId);

    if (!session) {
      if (urls.length === 0) return next();
      if (!(await executorFor(deps, maxUserId))) return next(); // фото от жителя — общий ответ
      await ctx.reply(
        'Чтобы приложить фото результата, нажмите «Выполнено» под нарядом — и пришлите фото следом.',
      );
      return;
    }

    if (text.startsWith('/')) return next(); // команды работают и в режиме фото

    if (urls.length === 0) {
      await ctx.reply(
        `Сейчас жду фото результата по заявке №${session.number}. Пришлите фото или нажмите «Завершить заявку».`,
        { attachments: [finishKeyboard(session.requestId)] },
      );
      return;
    }

    const mid = ctx.message?.body?.mid;
    if (!mid || !deps.photosDir) return next();
    const result = await savePhotos(
      deps,
      deps.photosDir,
      maxUserId,
      mid,
      urls.slice(0, MAX_PHOTOS_PER_MESSAGE),
      session.requestId,
    );
    if (!result.keepSession) sessions.delete(maxUserId);
    if (!result.text) return;
    await ctx.reply(
      result.text,
      result.keepSession ? { attachments: [finishKeyboard(session.requestId)] } : undefined,
    );
  });

  // Кнопки: exe:start | complete («Выполнено») | finish («Завершить») | back («Назад») | decline
  bot.action(/^exe:(start|complete|finish|back|decline):(.+)$/, async (ctx) => {
    const action = ctx.match?.[1];
    const requestId = ctx.match?.[2];
    const maxUserId = ctx.user?.user_id;
    const callbackId = ctx.callback?.callback_id;
    if (!action || !requestId || !maxUserId || !callbackId) return;

    let outcome: Outcome;
    let note: string | null = null;

    if (action === 'complete' && deps.photosDir) {
      outcome = await enterPhotoMode(deps, requestId, maxUserId);
      if (outcome.reply && outcome.number) {
        const previous = activeSession(maxUserId);
        if (previous && previous.requestId !== requestId) {
          note = `Приём фото по заявке №${previous.number} закрыт — теперь фото пойдут к заявке №${outcome.number}.`;
        }
        sessions.set(maxUserId, {
          requestId,
          number: outcome.number,
          until: Date.now() + PHOTO_SESSION_MS,
        });
      }
    } else if (action === 'back') {
      closeSession(maxUserId, requestId);
      outcome = await backToOrder(deps, requestId, maxUserId);
    } else {
      // «Выполнено» без режима фото (PHOTOS_DIR не задан) — сразу завершить заявку
      const key: ActionKey = action === 'complete' ? 'finish' : (action as ActionKey);
      outcome = await applyAction(deps, key, requestId, maxUserId, callbackId);
      if (outcome.reply && (key === 'finish' || key === 'decline'))
        closeSession(maxUserId, requestId);
    }

    if (outcome.silent) {
      // Повтор: только снимаем «крутилку» с кнопки, сообщение и чат не трогаем
      await ctx.answerOnCallback({}).catch(() => {});
      return;
    }

    if (outcome.reply) {
      // Успех: сообщение с кнопкой заменяется новым состоянием
      const attachments = outcome.keyboard ? [outcome.keyboard] : [];
      await ctx
        .answerOnCallback({ message: { text: outcome.reply, attachments } })
        .catch(() => ctx.reply(outcome.reply ?? '', { attachments }));
      if (note) await ctx.reply(note);
    } else {
      // Отказ (не ваша заявка, уже закрыта): сообщение не трогаем, объясняем отдельным
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
