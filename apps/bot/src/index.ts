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
console.log(`Бот @${me.username} запущен (long polling)`);
await bot.start();
