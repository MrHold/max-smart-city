import { asc, createDb, executors } from '@msc/db';
import { inviteToken } from '../invite';

// Печатает ссылки-приглашения для всех исполнителей. Ссылку отдают исполнителю:
// он открывает её в MAX, и бот привязывает его аккаунт к записи в executors.
const { DATABASE_URL, USER_HASH_SECRET, APP_LINK } = process.env;
if (!DATABASE_URL || !USER_HASH_SECRET || !APP_LINK) {
  console.error('Нужны DATABASE_URL, USER_HASH_SECRET и APP_LINK (https://max.ru/<ник бота>)');
  process.exit(1);
}

const { db, pool } = createDb(DATABASE_URL);
const rows = await db
  .select({ id: executors.id, nameShort: executors.nameShort, userId: executors.userId })
  .from(executors)
  .orderBy(asc(executors.nameShort));

for (const e of rows) {
  const status = e.userId ? ' — уже привязан' : '';
  console.log(
    `${e.nameShort}${status}\n  ${APP_LINK}?start=${inviteToken(e.id, USER_HASH_SECRET)}\n`,
  );
}
await pool.end();
