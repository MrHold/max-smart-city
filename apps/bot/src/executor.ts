import type { Bot } from '@maxhub/max-bot-api';
import {
  and,
  type Db,
  type DbOrTx,
  desc,
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
import { orderKeyboard, ordersListKeyboard, photoModeKeyboard } from './keyboards';
import {
  ACTIVE_STATUSES,
  type Attachment,
  activeOrders,
  imagesOf,
  orderView,
  type RequestRow,
  sendOrder,
  stageOf,
} from './order';
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
// Ограничение одно — на заявку. MAX делит большой альбом на несколько сообщений,
// и лимит «на сообщение» незаметно срезал фото из середины альбома.
const MAX_PHOTOS_PER_REQUEST = 10;

type Outcome = {
  popup: string;
  reply?: string;
  keyboard?: Attachment;
  /** Повтор уже выполненного действия: ничего не отвечаем, только снимаем «крутилку» с кнопки. */
  silent?: boolean;
  /** Номер заявки — нужен режиму фото для подсказок. */
  number?: string;
};

const SILENT: Outcome = { popup: '', silent: true };
const NOT_LINKED: Outcome = {
  popup: 'Вы не привязаны как исполнитель. Откройте ссылку-приглашение от диспетчера.',
};

/** Сообщение бота, под которым сейчас стоят кнопки режима фото. */
type Prompt = {
  mid: string;
  text: string;
  /**
   * true — служебный ответ («Фото добавлено…»): когда появится следующий, этот удаляем.
   * false — бывший наряд: там адрес и время, его не удаляем, а только снимаем кнопки.
   */
  removable: boolean;
  /** Фото жителей в бывшем наряде: при снятии кнопок их нужно передать заново. */
  images?: Attachment[];
};

/** Режим фото: исполнитель прикладывает фото к этой заявке, пока не нажмёт «Завершить» или «Назад». */
type PhotoSession = { requestId: string; number: string; until: number; prompt?: Prompt };

/** Как отправить ответ в чат; возвращает отправленное сообщение (нужен его mid). */
type Send = (
  text: string,
  extra: { attachments: Attachment[] },
) => Promise<{ body?: { mid?: string } } | undefined>;

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

/**
 * «Принял» / «Завершить заявку» / «Не могу» — одной транзакцией для всех заявок наряда:
 * одна проблема в доме, один наряд, и каждый автор получает своё уведомление.
 */
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

  // Карточку собираем до смены статуса: после «Не могу» заявки уже не будут связаны с исполнителем
  const view = await orderView(db, row);
  const now = await nowFor(db, deps.demoMode);
  const applied = await db.transaction(async (tx) => {
    // Повтор того же нажатия (или повторная доставка апдейта от MAX) — ничего не делаем
    const fresh = await tx
      .insert(processedUpdates)
      .values({ updateKey: `cb:${callbackId}` })
      .onConflictDoNothing()
      .returning({ key: processedUpdates.updateKey });
    if (fresh.length === 0) return null;

    const changed: RequestRow[] = [];
    for (const r of view.group) {
      const updated = await tx
        .update(requests)
        .set({
          status: next,
          updatedAt: now,
          ...(key === 'finish' ? { endedAt: now } : {}),
          ...(key === 'decline' ? { executorId: null } : {}),
        })
        // статус в условии: если диспетчер успел поменять заявку, ничего не перезаписываем
        .where(and(eq(requests.id, r.id), eq(requests.status, r.status)))
        .returning({ id: requests.id });
      if (updated.length > 0) changed.push(r);
    }
    if (changed.length === 0) return null;

    // Фото результата исполнитель прикладывает к наряду, то есть к одной заявке, —
    // копируем их остальным, чтобы результат увидел каждый житель.
    const photoCount = key === 'finish' ? await afterPhotos(tx, row.id) : 0;
    if (photoCount > 0) {
      const shots = await tx
        .select()
        .from(photos)
        .where(and(eq(photos.requestId, row.id), eq(photos.stage, 'after')));
      for (const r of changed) {
        if (r.id === row.id) continue;
        await tx.insert(photos).values(
          shots.map((s) => ({
            requestId: r.id,
            storageKey: s.storageKey,
            sha256: s.sha256,
            stage: 'after' as const,
            uploadedBy: s.uploadedBy,
            at: s.at,
          })),
        );
      }
    }

    for (const r of changed) {
      await tx.insert(requestEvents).values({
        requestId: r.id,
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
      const own = { requestId: r.id, number: r.number, nameShort: executor.nameShort };
      if (key === 'start')
        await enqueueNotification(tx, r.authorUserId, { type: 'in_progress', ...own });
      if (key === 'finish')
        await enqueueNotification(tx, r.authorUserId, {
          type: 'completed',
          ...own,
          photos: photoCount,
        });
    }

    const base = { requestId: row.id, number: row.number, nameShort: executor.nameShort };
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

  // Сообщение с кнопкой заменится этим текстом — карточку наряда (адрес, время) сохраняем
  const card = view.text;
  if (key === 'start') {
    return {
      popup: '',
      reply: `${card}\n\n▶️ Вы приступили к работе. Когда закончите — нажмите «Выполнено».`,
      keyboard: orderKeyboard(row.id, 'in_progress'),
    };
  }
  if (key === 'finish') {
    const n = applied.photoCount;
    const who =
      view.group.length > 1
        ? 'Жители получат уведомление и подтвердят работу.'
        : 'Житель получит уведомление и подтвердит работу.';
    return {
      popup: '',
      reply: `${card}\n\n✅ Наряд выполнен${n ? `, приложено фото: ${n}` : ' без фото'}. ${who}`,
    };
  }
  return {
    popup: '',
    reply: `${card}\n\nВы сняты с наряда. Диспетчер назначит другого исполнителя.`,
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
  const card = (await orderView(deps.db, row)).text;
  return {
    popup: '',
    number: row.number,
    reply:
      `${card}\n\n` +
      `📷 Пришлите фото результата — одно или несколько (до ${MAX_PHOTOS_PER_REQUEST}). ` +
      'Когда закончите, нажмите «Завершить заявку».' +
      (already ? `\nУже приложено фото: ${already}.` : ''),
    keyboard: photoModeKeyboard(row.id, already),
  };
}

/**
 * «Удалить последнее фото» в режиме фото: исполнитель ошибся снимком.
 * Удаляется только запись у этой заявки — сам файл может быть общим с другими заявками наряда.
 */
async function removeLastPhoto(
  deps: Deps,
  requestId: string,
  maxUserId: number,
): Promise<{ text: string; keepSession: boolean }> {
  const { db } = deps;
  const found = await executorFor(deps, maxUserId);
  if (!found) return { text: NOT_LINKED.popup, keepSession: false };
  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row || row.executorId !== found.executor.id)
    return { text: 'Эта заявка назначена не вам.', keepSession: false };
  if (!canTransition(row.status as RequestStatus, 'complete'))
    return { text: `Заявка №${row.number} уже закрыта — фото не изменить.`, keepSession: false };

  const [last] = await db
    .select({ id: photos.id })
    .from(photos)
    .where(
      and(
        eq(photos.requestId, row.id),
        eq(photos.stage, 'after'),
        eq(photos.uploadedBy, found.userId),
      ),
    )
    .orderBy(desc(photos.at))
    .limit(1);
  if (last) await db.delete(photos).where(eq(photos.id, last.id));

  const total = await afterPhotos(db, row.id);
  return {
    text: last
      ? `🗑 Фото удалено. Осталось: ${total} из ${MAX_PHOTOS_PER_REQUEST}. Пришлите другое или нажмите «Завершить заявку».`
      : 'Удалять нечего: фото к заявке ещё не приложены.',
    keepSession: true,
  };
}

/** «Назад» из режима фото: наряд снова с кнопками «Выполнено» / «Не могу». */
async function backToOrder(deps: Deps, requestId: string, maxUserId: number): Promise<Outcome> {
  const found = await executorFor(deps, maxUserId);
  if (!found) return NOT_LINKED;
  const [row] = await deps.db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row || row.executorId !== found.executor.id) return SILENT;
  if (!canTransition(row.status as RequestStatus, 'complete')) return SILENT; // уже завершена
  const card = (await orderView(deps.db, row)).text;
  const stage = stageOf(row.status);
  return {
    popup: '',
    reply: `${card}\n\n${stage === 'assigned' ? 'Наряд ждёт, когда вы его примете.' : 'Заявка остаётся в работе. Когда закончите — нажмите «Выполнено».'}`,
    keyboard: orderKeyboard(row.id, stage),
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
      text: `📷 Фото: ${before} из ${MAX_PHOTOS_PER_REQUEST} — это максимум, ${urls.length === 1 ? 'новое фото не сохранено' : 'новые фото не сохранены'}. Нажмите «Завершить заявку» или удалите лишнее.`,
      keepSession: true,
    };
  }

  const taken = urls.slice(0, MAX_PHOTOS_PER_REQUEST - before);
  const dropped = urls.length - taken.length;
  let added = 0;
  try {
    for (const url of taken) {
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
  if (dropped > 0) {
    return {
      text: `📷 Фото: ${total} из ${MAX_PHOTOS_PER_REQUEST} — это максимум, ещё ${dropped} не ${dropped === 1 ? 'сохранено' : 'сохранены'}. Нажмите «Завершить заявку» или удалите лишнее.`,
      keepSession: true,
    };
  }
  return {
    text: added
      ? `📷 Фото: ${total} из ${MAX_PHOTOS_PER_REQUEST}. Пришлите ещё или нажмите «Завершить заявку».`
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
  /** Закрыть режим фото по этой заявке; вернуть закрытую сессию, чтобы убрать её кнопки. */
  const closeSession = (maxUserId: number, requestId: string): PhotoSession | undefined => {
    const s = sessions.get(maxUserId);
    if (s?.requestId !== requestId) return undefined;
    sessions.delete(maxUserId);
    return s;
  };

  // Сообщения и нажатия одного исполнителя — строго по очереди. Три фото подряд иначе
  // обработались бы одновременно, и под двумя сообщениями остались бы кнопки.
  const queues = new Map<number, Promise<void>>();
  const oneByOne = (maxUserId: number, job: () => Promise<void>): Promise<void> => {
    const run = (queues.get(maxUserId) ?? Promise.resolve()).then(job);
    const tail = run.catch(() => {});
    queues.set(maxUserId, tail);
    void tail.then(() => {
      if (queues.get(maxUserId) === tail) queues.delete(maxUserId);
    });
    return run;
  };

  // Убрать кнопки со старого сообщения: служебное — удалить, бывший наряд — оставить без кнопок.
  // exceptMid — сообщение, которое прямо сейчас заменяется ответом на нажатие: его не трогаем.
  // Ошибки не страшны: сообщение могли удалить руками или оно слишком старое для правки.
  const retire = async (prompt: Prompt | undefined, exceptMid?: string): Promise<void> => {
    if (!prompt || prompt.mid === exceptMid) return;
    try {
      if (prompt.removable) await bot.api.deleteMessage(prompt.mid);
      else
        await bot.api.editMessage(prompt.mid, {
          text: prompt.text,
          attachments: prompt.images ?? [],
        });
    } catch (err) {
      console.warn(
        'Режим фото: не удалось убрать старые кнопки —',
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Ответ в режиме фото: новое сообщение с кнопками внизу чата, старое — убираем.
  // Сначала отправляем новое, потом убираем старое — кнопки не пропадают ни на миг.
  const showPrompt = async (session: PhotoSession, text: string, send: Send): Promise<void> => {
    const count = await afterPhotos(deps.db, session.requestId);
    const sent = await send(text, {
      attachments: [photoModeKeyboard(session.requestId, count)],
    });
    const old = session.prompt;
    const mid = sent?.body?.mid;
    session.prompt = mid ? { mid, text, removable: true } : undefined;
    await retire(old);
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

  // «Мои наряды»: активные наряды списком — чат не единственное место, где их искать
  const showOrders = async (maxUserId: number | undefined, reply: Send): Promise<void> => {
    const found = maxUserId ? await executorFor(deps, maxUserId) : null;
    if (!found) {
      await reply('Список нарядов — для исполнителей УК. Ваши заявки — в «Мой дом».', {
        attachments: [],
      });
      return;
    }
    const items = await activeOrders(deps.db, found.executor.id);
    if (items.length === 0) {
      await reply('Активных нарядов нет. Новый придёт сюда, как только диспетчер его назначит.', {
        attachments: [],
      });
      return;
    }
    await reply(`Ваши наряды: ${items.length}. Нажмите, чтобы открыть.`, {
      attachments: [ordersListKeyboard(items)],
    });
  };

  bot.command('orders', (ctx) =>
    showOrders(ctx.message?.sender?.user_id, (t, extra) => ctx.reply(t, extra)),
  );
  bot.action('exe:orders', async (ctx) => {
    await ctx.answerOnCallback({}).catch(() => {});
    await showOrders(ctx.user?.user_id, (t, extra) => ctx.reply(t, extra));
  });

  // Открыть наряд из списка: новое сообщение с карточкой, фото и кнопками текущего шага
  bot.action(/^exe:show:(.+)$/, async (ctx) => {
    const requestId = ctx.match?.[1];
    const maxUserId = ctx.user?.user_id;
    await ctx.answerOnCallback({}).catch(() => {});
    if (!requestId || !maxUserId) return;
    const found = await executorFor(deps, maxUserId);
    if (!found) {
      await ctx.reply(NOT_LINKED.popup);
      return;
    }
    const [row] = await deps.db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
    if (!row || row.executorId !== found.executor.id || !ACTIVE_STATUSES.includes(row.status)) {
      await ctx.reply('Этот наряд уже закрыт или передан другому исполнителю.');
      return;
    }
    const view = await orderView(deps.db, row);
    await sendOrder(
      (t, extra) => ctx.reply(t, extra),
      bot,
      deps.photosDir,
      view,
      row.id,
      stageOf(row.status),
    );
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

    if (!activeSession(maxUserId)) {
      if (urls.length === 0) return next();
      if (!(await executorFor(deps, maxUserId))) return next(); // фото от жителя — общий ответ
      await ctx.reply(
        'Чтобы приложить фото результата, нажмите «Выполнено» под нарядом — и пришлите фото следом.',
      );
      return;
    }

    if (text.startsWith('/')) return next(); // команды работают и в режиме фото

    const mid = ctx.message?.body?.mid;
    const send: Send = (t, extra) => ctx.reply(t, extra);

    await oneByOne(maxUserId, async () => {
      // Сессию берём заново: пока ждали очереди, заявку могли завершить
      const session = activeSession(maxUserId);
      if (!session) {
        if (urls.length) await ctx.reply('Приём фото по этой заявке уже закрыт.');
        return;
      }

      if (urls.length === 0) {
        await showPrompt(
          session,
          `Жду фото результата по заявке №${session.number}. Пришлите фото или нажмите «Завершить заявку».`,
          send,
        );
        return;
      }

      if (!mid || !deps.photosDir) return;
      const result = await savePhotos(
        deps,
        deps.photosDir,
        maxUserId,
        mid,
        urls,
        session.requestId,
      );

      if (!result.keepSession) {
        // Заявка закрыта или не ваша — режим фото выключаем и кнопки убираем
        sessions.delete(maxUserId);
        await retire(session.prompt);
        if (result.text) await ctx.reply(result.text);
        return;
      }
      if (result.text) await showPrompt(session, result.text, send);
    });
  });

  // «Удалить последнее фото» в режиме фото: ответ — новым сообщением внизу, как на само фото
  bot.action(/^exe:undo:(.+)$/, async (ctx) => {
    const requestId = ctx.match?.[1];
    const maxUserId = ctx.user?.user_id;
    await ctx.answerOnCallback({}).catch(() => {});
    if (!requestId || !maxUserId) return;
    const send: Send = (t, extra) => ctx.reply(t, extra);

    await oneByOne(maxUserId, async () => {
      const session = activeSession(maxUserId);
      if (session?.requestId !== requestId) {
        await ctx.reply('Режим фото по этой заявке уже закрыт — нажмите «Выполнено» под нарядом.');
        return;
      }
      const result = await removeLastPhoto(deps, requestId, maxUserId);
      if (!result.keepSession) {
        sessions.delete(maxUserId);
        await retire(session.prompt);
        await ctx.reply(result.text);
        return;
      }
      await showPrompt(session, result.text, send);
    });
  });

  // Кнопки: exe:start | complete («Выполнено») | finish («Завершить») | back («Назад») | decline
  bot.action(/^exe:(start|complete|finish|back|decline):(.+)$/, async (ctx) => {
    const action = ctx.match?.[1];
    const requestId = ctx.match?.[2];
    const maxUserId = ctx.user?.user_id;
    const callbackId = ctx.callback?.callback_id;
    if (!action || !requestId || !maxUserId || !callbackId) return;
    // Сообщение, под которым нажали кнопку: его заменит ответ, убирать его не нужно
    const pressedMid = ctx.message?.body?.mid;
    // Фото жителей из наряда переживают смену кнопок: MAX заменяет вложения целиком
    const images = imagesOf(ctx.message);

    await oneByOne(maxUserId, async () => {
      let outcome: Outcome;
      let note: string | null = null;

      if (action === 'complete' && deps.photosDir) {
        outcome = await enterPhotoMode(deps, requestId, maxUserId);
        if (outcome.reply && outcome.number) {
          const previous = activeSession(maxUserId);
          if (previous && previous.requestId !== requestId) {
            note = `Приём фото по заявке №${previous.number} закрыт — теперь фото пойдут к заявке №${outcome.number}.`;
          }
          if (previous) await retire(previous.prompt, pressedMid);
          // Наряд превращается в сообщение режима фото: при следующем ответе снимем с него
          // кнопки, но само сообщение оставим — в нём адрес и время
          sessions.set(maxUserId, {
            requestId,
            number: outcome.number,
            until: Date.now() + PHOTO_SESSION_MS,
            prompt: pressedMid
              ? { mid: pressedMid, text: outcome.reply, removable: false, images }
              : undefined,
          });
        }
      } else if (action === 'back') {
        const closed = closeSession(maxUserId, requestId);
        await retire(closed?.prompt, pressedMid);
        outcome = await backToOrder(deps, requestId, maxUserId);
      } else {
        // «Выполнено» без режима фото (PHOTOS_DIR не задан) — сразу завершить заявку
        const key: ActionKey = action === 'complete' ? 'finish' : (action as ActionKey);
        outcome = await applyAction(deps, key, requestId, maxUserId, callbackId);
        if (outcome.reply && (key === 'finish' || key === 'decline')) {
          const closed = closeSession(maxUserId, requestId);
          await retire(closed?.prompt, pressedMid);
        }
      }

      if (outcome.silent) {
        // Повтор: только снимаем «крутилку» с кнопки, сообщение и чат не трогаем
        await ctx.answerOnCallback({}).catch(() => {});
        return;
      }

      if (outcome.reply) {
        // Успех: сообщение с кнопкой заменяется новым состоянием
        const attachments = outcome.keyboard ? [...images, outcome.keyboard] : images;
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
  });
}

/** Имя исполнителя, если этот пользователь MAX к нему привязан, иначе null. */
export async function executorNameFor(deps: Deps, maxUserId: number): Promise<string | null> {
  const found = await executorFor(deps, maxUserId);
  return found?.executor.nameShort ?? null;
}
