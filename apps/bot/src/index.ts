import { Bot, Keyboard } from '@maxhub/max-bot-api';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан: проверь .env в корне проекта');
  process.exit(1);
}

const bot = new Bot(token);

const menu = Keyboard.inlineKeyboard([
  [Keyboard.button.callback('Контакты УК', 'home:contacts')],
  [Keyboard.button.link('Сайт хакатона', 'https://hackathon-max.vk.company')],
]);

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

const me = await bot.api.getMyInfo();
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
