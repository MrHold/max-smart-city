import type { Bot } from '@maxhub/max-bot-api';
import {
  and,
  type Db,
  encryptUserId,
  enqueueNotification,
  eq,
  executors,
  houses,
  memberships,
  or,
  processedUpdates,
  requestEvents,
  requests,
  userHash,
  users,
  verifyInvite,
} from '@msc/db';
import { type RequestStatus, TransitionError, transition, type WorkflowEvent } from '@msc/domain';
import { nowFor } from './clock';
import { orderKeyboard } from './keyboards';

export type Deps = { db: Db; hashSecret: string; encKey: Buffer; demoMode: boolean };

const ACTIONS = {
  start: { event: 'start', eventType: 'started' },
  complete: { event: 'complete', eventType: 'completed' },
  decline: { event: 'decline', eventType: 'declined' },
} as const satisfies Record<string, { event: WorkflowEvent; eventType: string }>;
type ActionKey = keyof typeof ACTIONS;

type Outcome = { popup: string; reply?: string; keyboard?: ReturnType<typeof orderKeyboard> };

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

  const userId = await userIdFor(deps, maxUserId, false);
  if (!userId) return notLinked;
  const [executor] = await db.select().from(executors).where(eq(executors.userId, userId)).limit(1);
  if (!executor) return notLinked;

  const [row] = await db.select().from(requests).where(eq(requests.id, requestId)).limit(1);
  if (!row) return { popup: 'Заявка не найдена.' };
  if (row.executorId !== executor.id) return { popup: 'Эта заявка назначена не вам.' };

  let next: RequestStatus;
  try {
    next = transition(row.status as RequestStatus, ACTIONS[key].event);
  } catch (err) {
    if (err instanceof TransitionError)
      return { popup: 'Заявка уже закрыта или изменена — ничего делать не нужно.' };
    throw err;
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

  if (!applied) return { popup: 'Уже отмечено.' };

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
 * Исполнитель в боте. Регистрировать РАНЬШЕ общих обработчиков: иначе /start inv_… перехватит
 * обычное приветствие.
 */
export function registerExecutor(bot: Bot, deps: Deps): void {
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

  // Кнопки под нарядом: exe:start|complete|decline:<id заявки>
  bot.action(/^exe:(start|complete|decline):(.+)$/, async (ctx) => {
    const key = ctx.match?.[1] as ActionKey | undefined;
    const requestId = ctx.match?.[2];
    const maxUserId = ctx.user?.user_id;
    const callbackId = ctx.callback?.callback_id;
    if (!key || !requestId || !maxUserId || !callbackId) return;

    const outcome = await applyAction(deps, key, requestId, maxUserId, callbackId);
    if (outcome.reply) {
      // Успех: наряд заменяется новым состоянием; после «Выполнено» и «Не могу» кнопок больше нет
      const attachments = outcome.keyboard ? [outcome.keyboard] : [];
      await ctx
        .answerOnCallback({ message: { text: outcome.reply, attachments } })
        .catch(() => ctx.reply(outcome.reply ?? '', { attachments }));
    } else {
      // Отказ (не ваша заявка, уже закрыта, повтор): наряд не трогаем, объясняем отдельным сообщением
      await ctx.answerOnCallback({}).catch(() => {});
      await ctx.reply(outcome.popup);
    }
  });
}

/** Имя исполнителя, если этот пользователь MAX к нему привязан, иначе null. */
export async function executorNameFor(deps: Deps, maxUserId: number): Promise<string | null> {
  const userId = await userIdFor(deps, maxUserId, false);
  if (!userId) return null;
  const [executor] = await deps.db
    .select({ nameShort: executors.nameShort })
    .from(executors)
    .where(eq(executors.userId, userId))
    .limit(1);
  return executor?.nameShort ?? null;
}