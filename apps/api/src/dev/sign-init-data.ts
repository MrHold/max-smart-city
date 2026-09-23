// Печатает подписанную initData для локальной проверки API без MAX:
//   pnpm --filter @msc/api sign-init-data [max_user_id] [имя]
// Подпись делается BOT_TOKEN из .env — тем же токеном, которым API её проверяет.
import { signInitData } from '../auth/init-data';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN не задан в .env');
  process.exit(1);
}

const id = Number(process.argv[2] ?? 100000001);
const firstName = process.argv[3] ?? 'Тестовый житель';

console.log(
  signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: `dev-${Date.now()}`,
      user: JSON.stringify({ id, first_name: firstName, language_code: 'ru' }),
    },
    token,
  ),
);
