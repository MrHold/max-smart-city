# Разработка

Как поднять проект у себя, запускать части по отдельности, проверять и вносить изменения.
Что это за продукт и как его проверить — в [README](../README.md), сервер и эксплуатация —
в [operations.md](operations.md).

---

## Содержание

1. [Установка](#установка)
2. [Что где лежит](#что-где-лежит)
3. [Команды](#команды)
4. [Мини-приложение без MAX](#мини-приложение-без-max)
5. [Тесты API на настоящей базе](#тесты-api-на-настоящей-базе)
6. [Демо-часы](#демо-часы)
7. [HTTP API](#http-api)
8. [Мини-приложение как образ](#мини-приложение-как-образ)
9. [Docker Desktop не стартует после падения](#docker-desktop-не-стартует-после-падения)
10. [Правила разработки](#правила-разработки)

---

## Установка

| Что | Версия | Как проверить |
|---|---|---|
| Node.js | 22 | `node -v` → `v22.x` |
| pnpm | 12.5.1 (ставится автоматически через corepack) | `pnpm -v` |
| Docker + Docker Compose v2 | любая актуальная | `docker compose version` |
| Git | любая | `git --version` |

```bash
git clone git@github.com:MrHold/max-smart-city.git
cd max-smart-city
pnpm install                 # библиотеки по pnpm-lock.yaml
cp .env.example .env         # локальные настройки; .env в git не попадает
docker compose up -d db      # Postgres в фоне
docker compose ps            # у db должно быть (healthy)
pnpm typecheck               # проверка типов во всех пакетах
```

Если всё прошло без ошибок — окружение готово.

### Windows

Работайте внутри WSL 2 (Ubuntu), а не в PowerShell, и держите репозиторий в файловой системе
WSL (`~/projects/...`), не на диске `C:`.

1. PowerShell от администратора: `wsl --install -d Ubuntu`, перезагрузка.
2. Docker Desktop → Settings → Resources → WSL integration → включить Ubuntu.
3. В терминале Ubuntu:
   ```bash
   sudo apt update && sudo apt install -y git curl unzip build-essential
   curl -fsSL https://fnm.vercel.app/install | bash
   source ~/.bashrc
   fnm install 22 && fnm default 22
   corepack enable pnpm
   git config --global core.autocrlf input
   ```
4. VS Code: расширение **WSL**; проект открывать командой `code .` из терминала Ubuntu.

---

## Что где лежит

```
apps/
  bot/          @msc/bot        чат-бот MAX: меню, наряды исполнителю, уведомления из очереди outbox
  api/          @msc/api        HTTP API мини-приложения, вход по подписи initData из MAX
  miniapp/      @msc/miniapp    мини-приложение (React + Vite): экраны жителя и диспетчера, моки MAX Bridge и API
packages/
  domain/       @msc/domain     ядро без БД: договоры данных (zod), статусы, сроки, перерасчёт, кластеры
  db/           @msc/db         схема БД (Drizzle), миграции, шифрование идентификаторов MAX
  documents/    @msc/documents  PDF: заявление о перерасчёте, обращение в ГЖИ
regions/        данные регионов: категории, сроки, тарифы, нормативы, УК, дома
rules/federal/  федеральные нормы: ПП № 354, ПП № 416
```

Бэкенд (бот и API) запускается из TypeScript напрямую через `tsx`, без шага сборки.
`tsc` используется только для проверки типов. Мини-приложение собирается Vite в статические файлы.

Мини-приложение написано на React 19: библиотека `@maxhub/max-ui` требует ровно `react@19.2.8`.
Интерфейс собран своими компонентами, из MAX UI используется провайдер платформы.

---

## Команды

Все команды — из корня репозитория.

| Команда | Что делает |
|---|---|
| `pnpm install` | установить зависимости по lock-файлу |
| `pnpm typecheck` | проверить типы во всех пакетах |
| `pnpm test` | запустить тесты во всех пакетах |
| `pnpm lint` | проверить стиль и подозрительные места (Biome) |
| `pnpm format` | исправить стиль автоматически |
| `pnpm --filter @msc/<пакет> add -E <библиотека>` | добавить зависимость в пакет (`-D` — для разработки) |
| `pnpm --filter @msc/db db:migrate` | применить миграции к базе из `DATABASE_URL` |
| `pnpm --filter @msc/api dev` | API с перезапуском при изменениях, `http://localhost:3001/api/health` |
| `pnpm --filter @msc/miniapp dev` | мини-приложение в браузере, `http://localhost:5173` |
| `pnpm --filter @msc/miniapp build` | собрать статику в `apps/miniapp/dist` |
| `pnpm --filter @msc/api sign-init-data` | подписанная initData для работы в браузере с настоящим API |

---

## Мини-приложение без MAX

В браузере нет `window.WebApp`, поэтому в режиме разработки подставляется мок MAX Bridge с тестовым
пользователем. Диплинки проверяются параметром в адресе: `?startapp=r_<id>` — «У меня тоже»,
`?startapp=req_<id>` — карточка, `?startapp=disp_<id>` — кабинет диспетчера на группе этой заявки.

С `VITE_API_MOCK=1` мини-приложение работает на встроенном моке API с образцовыми заявками и не ходит
в бэкенд. Чтобы работать с настоящим API:

```bash
docker compose up -d db && pnpm --filter @msc/db db:migrate   # база и схема
pnpm --filter @msc/api sign-init-data                          # последняя строка → VITE_DEV_INIT_DATA в .env
# в .env: VITE_API_MOCK=0, CORS_ORIGIN=http://localhost:5173, BOT_TOKEN=dev-token, INIT_DATA_MAX_AGE_SEC=86400
pnpm --filter @msc/api dev
pnpm --filter @msc/miniapp dev
```

Подписанная initData уходит в заголовке `X-Init-Data` как есть, поэтому API принимает мок-пользователя
как настоящего: он создаётся в базе при первом `GET /api/me`.

---

## Тесты API на настоящей базе

Заявка живёт в нескольких таблицах и транзакциях, поэтому маршруты проверяются не на моках,
а на живой базе. Тесты берут её из `TEST_DATABASE_URL`; если переменная не задана, они
пропускаются, и `pnpm test` проходит без поднятого Postgres.

```bash
docker compose up -d db
docker compose exec db psql -U msc -d postgres -c 'create database msc_test'
TEST_DATABASE_URL=postgres://msc:msc_local_only@localhost:5432/msc_test pnpm --filter @msc/api test
```

Тестовая база очищается перед каждым тестом, миграции применяются автоматически.
Рабочую базу тесты не трогают.

---

## Демо-часы

При `DEMO_MODE=1` время можно перематывать, чтобы показать просрочку и рост суммы. Сдвиг лежит
в базе одной строкой, поэтому его видят и API, и бот.

```bash
curl http://localhost:3001/api/demo/clock                      # текущий сдвиг
curl -X POST http://localhost:3001/api/demo/clock \
  -H "X-Init-Data: $INIT_DATA" -H 'Content-Type: application/json' \
  -d '{"shiftHours": 3}'                                       # вперёд на 3 часа
curl -X POST http://localhost:3001/api/demo/clock \
  -H "X-Init-Data: $INIT_DATA" -H 'Content-Type: application/json' \
  -d '{"reset": true}'                                         # вернуть настоящее время
```

Сдвиг влияет на сроки, просрочку, сумму перерасчёта и доступность шага в ГЖИ.
Свежесть входа проверяется по настоящему времени: иначе перемотка вперёд выбрасывала бы
пользователя с ошибкой «Сессия устарела». Вне демо-режима маршрутов нет.

---

## HTTP API

Отдельного публичного API как продукта нет: HTTP API обслуживает только наше мини-приложение.
Формат каждого запроса и ответа описан схемами zod в `packages/domain/src/contracts` — это и есть
контракт между фронтом и бэкендом, по нему же проверяются ответы в тестах.

| Метод | Путь | Что |
|---|---|---|
| GET | `/api/health` | проверка живости, текущее время сервера |
| GET | `/api/houses?q=` | поиск дома по адресу, от 3 символов |
| GET | `/api/houses/:id/home` | контакты УК со статусом «открыто до…» по местному времени дома, объявление |
| GET | `/api/houses/:id/categories` | категории заявок для региона дома |
| GET | `/api/me` | кто вошёл: профиль MAX, роль, дом, согласие; первый вызов создаёт пользователя |
| POST | `/api/me/house` | привязка к дому и квартире `{ houseId, apartmentLabel }` |
| POST | `/api/photos` | загрузка фото (`multipart`, поле `file`, до 5 МБ, JPEG/PNG/WebP/HEIC) |
| GET | `/api/photos/*` | отдача загруженного фото |
| GET | `/api/me/data` | что о пользователе хранится: состав, количество записей и зачем каждая нужна |
| DELETE | `/api/me` | удалить привязку к дому, согласия, присоединения и очередь уведомлений |
| GET | `/api/requests/:id/documents/claim.pdf` | заявление о перерасчёте, когда посчитана сумма |
| GET | `/api/requests/:id/documents/gji.pdf` | обращение в ГЖИ, когда истёк срок ответа УК (`gji.available`) |
| POST | `/api/requests/:id/documents/{claim,gji}/link` | свежая подписанная ссылка на PDF: `{ url, expiresAt }` |

Маршруты с входом ждут заголовок `X-Init-Data` с подписанной initData из MAX; без него — `401`.
Ошибки всегда в одном формате: `{ "error": { "code": "not_found", "message": "Дом не найден" } }`.

**Удаление данных.** Заявки при `DELETE /api/me` не стираются, а перестают быть связаны с человеком:
они нужны дому, УК и соседям, которые к ним присоединились. У пользователя затираются хеш и шифротекст
идентификатора MAX — строка больше никому не соответствует, следующий вход создаёт нового пользователя.

**Ссылки на PDF.** Кнопка в мини-приложении открывает PDF переходом, а браузер не отправляет
`X-Init-Data`, поэтому адрес подписывается на `DOC_LINK_TTL_MIN` минут (`…/claim.pdf?exp=…&sig=…`).
Право проверяется при выдаче ссылки, подделанная или просроченная подпись — `403`. Жалоба в ГЖИ
раньше срока — `409`: инспекция вернула бы её как преждевременную. Шрифты для PDF берутся из pdfmake.

---

## Мини-приложение как образ

`apps/miniapp/Dockerfile` собирает статику и кладёт её в `caddy:2-alpine` с `apps/miniapp/Caddyfile`:
Caddy отдаёт мини-приложение, проксирует `/api/*` в `api:3001` и `/webhook*` в `bot:3002`.

```bash
docker build -f apps/miniapp/Dockerfile -t msc-miniapp .
docker run --rm -p 8080:80 msc-miniapp            # http://localhost:8080 — без TLS
docker run --rm -p 80:80 -p 443:443 -e PUBLIC_DOMAIN=example.ru msc-miniapp   # на сервере: HTTPS сам
```

Переменные `VITE_*` передаются в сборку аргументами: `--build-arg VITE_BOT_NAME=…`.

---

## Docker Desktop не стартует после падения

Если при запуске выпадает «An unexpected error occurred» с текстом про
`rename …sock …stale: The file cannot be accessed by the system` — это файлы сокетов
от прошлого аварийного завершения. Нажать **Quit** (не «Reset to factory defaults»,
она сносит контейнеры и образы) и из WSL выполнить:

```bash
bash scripts/fix-docker-desktop.sh
```

Контейнеры, образы и база при этом не страдают: они внутри виртуальной машины.

---

## Правила разработки

- **Ветки** по зонам: `a/…`, `b/…`, `v/…`. В `master` — только через pull request, его смотрит хотя бы один
  другой участник.
- **Договоры** между частями — в `packages/domain/src/contracts`; меняются только PR с одобрением обеих сторон.
- **Зависимости** — только командой `pnpm --filter … add -E`, точные версии, без `^`. `pnpm-lock.yaml`
  коммитится вместе с `package.json`.
- **Стиль** — перед коммитом `pnpm format && pnpm lint`.
- **Секреты** — только в `.env`. В репозитории — `.env.example` без рабочих значений. Новая переменная
  добавляется в `.env.example` в том же PR, что и код, который её использует.
- **Бот с настоящим токеном** запускается только у одного человека: локальный polling снимает webhook
  с бота на сервере. Остальные работают с мини-приложением через мок MAX Bridge.
- **README и документация** обновляются в том же PR, что и изменение, которое они описывают.
