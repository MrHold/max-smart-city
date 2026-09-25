import { Bot, Keyboard } from '@maxhub/max-bot-api';
import { createDb, parseEncKey } from '@msc/db';
import { registerExecutor } from './executor';
import { startOutbox } from './outbox';

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

const menu = Keyboard.inlineKeyboard([
  [Keyboard.button.openApp('Мой дом', me.username, me.user_id)],
  [Keyboard.button.callback('Контакты УК', 'home:contacts')],
  [Keyboard.button.link('Сайт хакатона', 'https://hackathon-max.vk.company')],
]);

// База нужна исполнителям и почтальону. Без неё бот всё равно отвечает в чате.
const databaseUrl = process.env.DATABASE_URL;
const encKeyBase64 = process.env.USER_ID_ENC_KEY;
const hashSecret = process.env.USER_HASH_SECRET;
const db = databaseUrl ? createDb(databaseUrl).db : null;
const encKey = encKeyBase64 ? parseEncKey(encKeyBase64) : null;

// Исполнитель: приглашение inv_… и кнопки наряда. Регистрируется РАНЬШЕ приветствия и /start,
// иначе «/start inv_…» перехватит обычное меню.
if (db && encKey && hashSecret) {
  registerExecutor(bot, { db, hashSecret, encKey, demoMode: process.env.DEMO_MODE === '1' });
  console.log('Исполнители в боте включены');
} else {
  console.warn(
    'Исполнители выключены: не заданы DATABASE_URL, USER_ID_ENC_KEY или USER_HASH_SECRET',
  );
}

bot.on('bot_started', (ctx) => {
  const name = ctx.user?.first_name ?? 'сосед';
  return ctx.reply(`Здравствуйте, ${name}! Я помогу сообщить о проблеме в доме.`, {
    attachments: [menu],
  });
});

bot.command('start', (ctx) => ctx.reply('Главное меню', { attachments: [menu] }));

bot.action('home:contacts', (ctx) => ctx.reply('Контакты УК появятся после привязки к дому.'));

bot.on('message_created', (ctx) =>
  ctx.reply('Я пока понимаю только /start. Нажмите кнопку в меню.', { attachments: [menu] }),
);

bot.catch((err) => {
  console.error('Ошибка в обработчике:', err);
});

// Почтальон: рассылает уведомления и наряды, которые API кладёт в outbox
if (db && encKey) {
  startOutbox({ bot, db, encKey, botUsername: me.username, botId: me.user_id });
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
