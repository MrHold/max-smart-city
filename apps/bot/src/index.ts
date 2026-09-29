import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { createDb, parseEncKey } from '@msc/db';
import { ignoreRepeatedTaps } from './debounce';
import { type Deps, executorNameFor, registerExecutor } from './executor';
import { startOutbox } from './outbox';
import { botCommands, contactsText, executorNote, fallbackText, welcomeText } from './texts';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан: проверь .env в корне проекта');
  process.exit(1);
}

const bot = new Bot(token);

// Имя и id бота нужны кнопке мини-приложения: MAX открывает приложение того бота, чьё имя указано
const me = await bot.api.getMyInfo();
if (!me.username) {
  console.error('У бота нет публичного имени — кнопку мини-приложения не построить');
  process.exit(1);
}
const botUsername = me.username; // проверенное имя: string, без null — им пользуются обработчики ниже

const menu = Keyboard.inlineKeyboard([
  [Keyboard.button.openApp('Мой дом', botUsername, me.user_id)],
  [Keyboard.button.callback('Контакты УК', 'home:contacts')],
  [Keyboard.button.callback('ℹ️ Что умеет бот', 'home:help')],
]);

// Двойной тап по кнопке: второе нажатие молча игнорируется. Первым — до всех обработчиков кнопок.
ignoreRepeatedTaps(bot);

// База нужна исполнителям и почтальону. Без неё бот всё равно отвечает в чате.
const databaseUrl = process.env.DATABASE_URL;
const encKeyBase64 = process.env.USER_ID_ENC_KEY;
const hashSecret = process.env.USER_HASH_SECRET;
const db = databaseUrl ? createDb(databaseUrl).db : null;
const encKey = encKeyBase64 ? parseEncKey(encKeyBase64) : null;
const executorDeps: Deps | null =
  db && encKey && hashSecret
    ? {
        db,
        hashSecret,
        encKey,
        demoMode: process.env.DEMO_MODE === '1',
        // Та же папка, что у API (на сервере — общий том photos): фото от исполнителя видно в карточке
        photosDir: process.env.PHOTOS_DIR ?? null,
      }
    : null;

// Исполнитель: приглашение inv_…, кнопки наряда и фото результата. Регистрируется РАНЬШЕ
// приветствия и /start, иначе «/start inv_…» перехватит обычное меню, а фото — «Не понял сообщение».
if (executorDeps) {
  registerExecutor(bot, executorDeps);
  console.log(
    `Исполнители в боте включены${executorDeps.photosDir ? `, фото — в ${executorDeps.photosDir}` : ', приём фото выключен (нет PHOTOS_DIR)'}`,
  );
} else {
  console.warn(
    'Исполнители выключены: не заданы DATABASE_URL, USER_ID_ENC_KEY или USER_HASH_SECRET',
  );
}

const executorMenu = Keyboard.inlineKeyboard([
  [Keyboard.button.callback('🛠 Мои наряды', 'exe:orders')],
  [Keyboard.button.openApp('Мой дом', botUsername, me.user_id)],
  [Keyboard.button.callback('Контакты УК', 'home:contacts')],
]);

/** Приветствие с описанием; исполнителю — ещё строка про наряды и кнопка их списка. */
async function greeting(name: string | null | undefined, maxUserId: number | undefined) {
  let text = welcomeText(name);
  if (executorDeps && maxUserId) {
    const executorName = await executorNameFor(executorDeps, maxUserId).catch(() => null);
    if (executorName) {
      text += executorNote(executorName);
      return { text, keyboard: executorMenu };
    }
  }
  return { text, keyboard: menu };
}

const greet = async (
  reply: (text: string, extra: { attachments: Array<typeof menu> }) => Promise<unknown>,
  name: string | null | undefined,
  maxUserId: number | undefined,
) => {
  const { text, keyboard } = await greeting(name, maxUserId);
  await reply(text, { attachments: [keyboard] });
};

bot.on('bot_started', (ctx) =>
  greet((t, e) => ctx.reply(t, e), ctx.user?.first_name, ctx.user?.user_id),
);

bot.command(['start', 'help'], (ctx) =>
  greet((t, e) => ctx.reply(t, e), ctx.message?.sender?.first_name, ctx.message?.sender?.user_id),
);

bot.action('home:help', (ctx) =>
  greet((t, e) => ctx.reply(t, e), ctx.user?.first_name, ctx.user?.user_id),
);

bot.action('home:contacts', (ctx) =>
  ctx.reply(contactsText, {
    attachments: [
      Keyboard.inlineKeyboard([[Keyboard.button.openApp('Мой дом', botUsername, me.user_id)]]),
    ],
  }),
);

bot.on('message_created', (ctx) => ctx.reply(fallbackText, { attachments: [menu] }));

bot.catch((err) => {
  console.error('Ошибка в обработчике:', err);
});

// Подсказка команд при вводе «/» в чате. Не получилось — не страшно, бот работает и без неё.
await bot.api.setMyCommands(botCommands).catch((err) => {
  console.warn('Не удалось задать список команд:', err instanceof Error ? err.message : err);
});

// Почтальон: рассылает уведомления и наряды, которые API кладёт в outbox
if (db && encKey) {
  startOutbox({
    bot,
    db,
    encKey,
    botUsername,
    botId: me.user_id,
    photosDir: process.env.PHOTOS_DIR ?? null,
  });
  console.log('Уведомления из outbox включены');
} else {
  console.warn('Уведомления выключены: не заданы DATABASE_URL или USER_ID_ENC_KEY');
}

const mode = process.env.BOT_MODE ?? 'polling';

if (mode === 'webhook') {
  // На сервере: MAX сам присылает апдейты на https://<домен>/webhook, Caddy передаёт их сюда
  const domain = process.env.PUBLIC_DOMAIN;
  const secret = process.env.WEBHOOK_SECRET;
  if (!domain || !secret) {
    console.error('Для BOT_MODE=webhook нужны PUBLIC_DOMAIN и WEBHOOK_SECRET');
    process.exit(1);
  }
  const port = Number(process.env.BOT_PORT ?? 3002);
  await bot.start({ mode: 'webhook', options: { domain, port, path: '/webhook', secret } });
  console.log(`Бот @${me.username} запущен (webhook https://${domain}/webhook, порт ${port})`);
} else {
  // Локально: бот сам спрашивает у MAX новые апдейты.
  // Внимание: при старте polling снимает подписку webhook — не запускать с настоящим токеном,
  // когда бот работает на сервере.
  console.log(`Бот @${me.username} запущен (long polling)`);
  await bot.start();
}
