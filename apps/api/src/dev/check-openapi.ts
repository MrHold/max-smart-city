// Проверяет, что живой сервер отвечает ровно так, как написано в openapi.yaml:
//   pnpm --filter @msc/api check-openapi                        — сервер проверки (belyaevmaxim.ru)
//   API_URL=http://localhost:3001 pnpm --filter @msc/api check-openapi
//   API_URL=http://localhost:3001 CHECK_WRITES=1 pnpm --filter @msc/api check-openapi
//
// Для каждого запроса сверяется: код ответа описан у этого маршрута в openapi.yaml, тело
// проходит JSON-схему из openapi.yaml, и в ответе нет полей, которых в схеме нет.
//
// На сервере проверки ничего не создаётся: заявки, присоединения, приёмка и перемотка
// демо-часов проверяются только запросами, которые сервер отклоняет до записи в базу.
// Работают два тестовых пользователя с выдуманными id MAX; в конце их данные удаляются
// через DELETE /api/me. Полный сценарий с созданием заявки (CHECK_WRITES=1) — только
// на локальном сервере.
//
// Подписывает вход BOT_TOKEN из .env — нужен тот же токен, что у проверяемого сервера.
// Не печатает ни initData, ни тела ответов, ни ссылки-приглашения: только коды и имена схем.
import { readFileSync } from 'node:fs';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { parse } from 'yaml';
import { signInitData } from '../auth/init-data';
import { openApiFile } from '../openapi/spec';

const base = (process.env.API_URL ?? 'https://belyaevmaxim.ru').replace(/\/+$/, '');
const token = process.env.BOT_TOKEN;
const writes = process.env.CHECK_WRITES === '1';
const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base);

if (!token) {
  console.error('BOT_TOKEN не задан в .env — без него не подписать вход тестового пользователя');
  process.exit(1);
}
if (writes && !local) {
  console.error(
    'CHECK_WRITES=1 создаёт заявки — только для локального сервера (API_URL=http://localhost:…)',
  );
  process.exit(1);
}

// ── openapi.yaml → валидаторы ─────────────────────────────────────────────────────────

type Doc = {
  paths: Record<string, Record<string, Operation>>;
  components: { responses: Record<string, Response>; schemas: Record<string, unknown> };
};
type Response = { $ref?: string; content?: Record<string, { schema?: unknown }> };
type Operation = { responses: Record<string, Response> };

const doc = parse(readFileSync(openApiFile, 'utf8')) as Doc;

/**
 * Строгая копия документа: у объектов без additionalProperties запрещаем лишние поля.
 * В самом openapi.yaml этого нет (клиенту лишнее поле не мешает), но здесь мы хотим
 * узнать, если сервер отдаёт что-то, чего нет в описании.
 */
function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = strict(v);
  if (out.type === 'object' && out.properties && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }
  return out;
}

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
ajv.addSchema({ $id: 'openapi', ...(strict(doc) as object) });

const pointer = (...parts: string[]) =>
  `openapi#/${parts.map((p) => p.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;

/** Шаблон пути из openapi.yaml, которому соответствует конкретный адрес. */
function templateOf(method: string, pathname: string): string | undefined {
  return Object.keys(doc.paths).find((t) => {
    if (!doc.paths[t]?.[method]) return false;
    const re = new RegExp(`^${t.replace(/\{\w+\}/g, '[^/]+')}$`);
    return re.test(pathname);
  });
}

/** Описание ответа с кодом status: либо прямо в операции, либо ссылкой на components.responses. */
function responseOf(template: string, method: string, status: number) {
  const r = doc.paths[template]?.[method]?.responses[String(status)];
  if (!r) return undefined;
  if (r.$ref) {
    const name = r.$ref.split('/').pop() as string;
    return {
      spec: doc.components.responses[name] as Response,
      at: ['components', 'responses', name],
    };
  }
  return { spec: r, at: ['paths', template, method, 'responses', String(status)] };
}

const validators = new Map<string, ValidateFunction>();
function validatorFor(ref: string): ValidateFunction {
  let v = validators.get(ref);
  if (!v) {
    v = ajv.getSchema(ref);
    if (!v) throw new Error(`Нет схемы ${ref}`);
    validators.set(ref, v);
  }
  return v;
}

// ── Запросы ───────────────────────────────────────────────────────────────────────────

const users = {
  A: { id: 900000001, first_name: 'Проверка API А' },
  B: { id: 900000002, first_name: 'Проверка API Б' },
} as const;
type Who = keyof typeof users | 'garbage' | undefined;

function initDataOf(who: keyof typeof users): string {
  const u = users[who];
  return signInitData(
    {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: `openapi-check-${Date.now()}`,
      user: JSON.stringify({ ...u, language_code: 'ru' }),
    },
    token as string,
  );
}

interface Check {
  title: string;
  method: 'get' | 'post' | 'delete';
  /** Конкретный адрес, можно с ?query */
  url: string;
  as?: Who;
  json?: unknown;
  multipart?: { name: string; mime: string; bytes: Buffer };
  raw?: { type: string; body: string };
  /** Какой код ждём: проверка сценария, а не только описания */
  expect: number | number[];
}

let failures = 0;
const coverage = new Map<string, Set<number>>();

async function run(c: Check): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (c.as === 'garbage') headers['x-init-data'] = 'user=%7B%7D&hash=00';
  else if (c.as) headers['x-init-data'] = initDataOf(c.as);

  let body: string | FormData | undefined;
  if (c.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(c.json);
  } else if (c.raw) {
    headers['content-type'] = c.raw.type;
    body = c.raw.body;
  } else if (c.multipart) {
    const form = new FormData();
    form.append(
      c.multipart.name,
      new Blob([new Uint8Array(c.multipart.bytes)], { type: c.multipart.mime }),
      'check.png',
    );
    body = form;
  }

  const res = await fetch(base + c.url, { method: c.method.toUpperCase(), headers, body });
  const pathname = new URL(base + c.url).pathname;
  const template = templateOf(c.method, pathname);
  const contentType = res.headers.get('content-type') ?? '';
  const problems: string[] = [];
  let schemaName = '';
  let parsed: unknown;

  const expected = [c.expect].flat();
  if (!expected.includes(res.status)) problems.push(`ждали ${expected.join(' или ')}`);

  if (!template) {
    problems.push('маршрута нет в openapi.yaml');
  } else {
    const key = `${c.method.toUpperCase()} ${template}`;
    coverage.set(key, (coverage.get(key) ?? new Set()).add(res.status));

    const described = responseOf(template, c.method, res.status);
    if (!described) {
      problems.push(`код ${res.status} у этого маршрута не описан`);
    } else {
      const content = described.spec.content ?? {};
      const media = Object.keys(content).find((m) =>
        m.endsWith('/*') ? contentType.startsWith(m.slice(0, -1)) : contentType.startsWith(m),
      );
      if (!media) {
        problems.push(
          `Content-Type ${contentType || '—'}, в описании: ${Object.keys(content).join(', ')}`,
        );
      } else if (media === 'application/json') {
        parsed = await res.json();
        const ref = pointer(...described.at, 'content', media, 'schema');
        const schema = content[media]?.schema as { $ref?: string; items?: { $ref?: string } };
        schemaName =
          schema.$ref?.split('/').pop() ??
          (schema.items?.$ref ? `${schema.items.$ref.split('/').pop()}[]` : 'схема');
        const validate = validatorFor(ref);
        if (!validate(parsed)) {
          for (const e of (validate.errors ?? []).slice(0, 5)) {
            const extra =
              e.keyword === 'additionalProperties'
                ? ` «${(e.params as { additionalProperty: string }).additionalProperty}» — поля нет в схеме`
                : ` ${e.message}`;
            problems.push(`${e.instancePath || '/'}${extra}`);
          }
        }
      } else {
        schemaName = media;
        await res.arrayBuffer();
      }
    }
  }
  if (parsed === undefined && !res.bodyUsed) await res.arrayBuffer();

  const where = template ?? pathname;
  const line = `${res.status} ${c.method.toUpperCase().padEnd(6)} ${where}${schemaName ? ` → ${schemaName}` : ''}`;
  // Сообщение сервера помогает понять неожиданный код; в ошибках API секретов нет
  const apiError = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
  if (apiError && !expected.includes(res.status)) {
    problems.push(`сервер ответил: ${apiError.code} — ${apiError.message}`);
  }
  if (problems.length) {
    failures++;
    console.log(`✗ ${line}   ${c.title}`);
    for (const p of problems) console.log(`    ${p}`);
  } else {
    console.log(`✓ ${line}   ${c.title}`);
  }
  return parsed;
}

// ── Сценарий ──────────────────────────────────────────────────────────────────────────

const ZERO = '00000000-0000-0000-0000-000000000000';
// Самый маленький PNG: 1×1, прозрачный
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

type Obj = Record<string, unknown>;
const list = (v: unknown) => (Array.isArray(v) ? (v as Obj[]) : []);

async function scenario() {
  console.log(`Сервер: ${base}${writes ? ' (полный сценарий с записью)' : ''}\n`);

  // Открытые маршруты
  await run({ title: 'сервер жив', method: 'get', url: '/api/health', expect: 200 });
  const houses = list(
    await run({
      title: 'поиск дома',
      method: 'get',
      url: `/api/houses?q=${encodeURIComponent('Садовая')}`,
      expect: 200,
    }),
  );
  await run({ title: 'короткий запрос', method: 'get', url: '/api/houses?q=ab', expect: 400 });
  const houseId = String(houses[0]?.id ?? 'house-16-kazan-001');
  await run({
    title: 'экран «Мой дом»',
    method: 'get',
    url: `/api/houses/${houseId}/home`,
    expect: 200,
  });
  const categories = list(
    await run({
      title: 'категории',
      method: 'get',
      url: `/api/houses/${houseId}/categories`,
      expect: 200,
    }),
  );
  await run({
    title: 'нет такого дома',
    method: 'get',
    url: '/api/houses/no-such-house/home',
    expect: 404,
  });
  await run({
    title: 'нет такого дома',
    method: 'get',
    url: '/api/houses/no-such-house/categories',
    expect: 404,
  });
  await run({ title: 'демо-часы', method: 'get', url: '/api/demo/clock', expect: [200, 404] });

  // Вход
  await run({ title: 'без входа', method: 'get', url: '/api/me', expect: 401 });
  await run({
    title: 'поддельная подпись',
    method: 'get',
    url: '/api/me',
    as: 'garbage',
    expect: 401,
  });
  await run({ title: 'тестовый житель А', method: 'get', url: '/api/me', as: 'A', expect: 200 });
  await run({ title: 'тестовый житель Б', method: 'get', url: '/api/me', as: 'B', expect: 200 });

  // Привязка к дому
  await run({
    title: 'тело не JSON',
    method: 'post',
    url: '/api/me/house',
    as: 'A',
    raw: { type: 'application/xml', body: '<house/>' },
    expect: 415,
  });
  await run({
    title: 'пустая привязка',
    method: 'post',
    url: '/api/me/house',
    as: 'A',
    json: {},
    expect: 400,
  });
  await run({
    title: 'чужой дом',
    method: 'post',
    url: '/api/me/house',
    as: 'A',
    json: { houseId: 'no-such-house', apartmentLabel: 'кв. 9999' },
    expect: 404,
  });
  await run({
    title: 'А выбирает дом',
    method: 'post',
    url: '/api/me/house',
    as: 'A',
    json: { houseId, apartmentLabel: 'кв. 9999' },
    expect: 200,
  });
  await run({
    title: 'какие данные хранятся',
    method: 'get',
    url: '/api/me/data',
    as: 'A',
    expect: 200,
  });

  // Заявки — на сервере проверки только отказы до записи
  await run({ title: 'мои заявки', method: 'get', url: '/api/requests', as: 'A', expect: 200 });
  await run({
    title: 'пустая заявка',
    method: 'post',
    url: '/api/requests',
    as: 'A',
    json: {},
    expect: 400,
  });
  await run({
    title: 'нет такой заявки',
    method: 'get',
    url: `/api/requests/${ZERO}`,
    as: 'A',
    expect: 404,
  });
  await run({
    title: 'id не UUID',
    method: 'get',
    url: '/api/requests/not-a-uuid',
    as: 'A',
    expect: 404,
  });
  await run({
    title: 'пустое «У меня тоже»',
    method: 'post',
    url: `/api/requests/${ZERO}/join`,
    as: 'A',
    json: {},
    expect: 400,
  });
  await run({
    title: '«У меня тоже» к несуществующей',
    method: 'post',
    url: `/api/requests/${ZERO}/join`,
    as: 'A',
    json: { apartmentLabel: 'кв. 9999', measurements: [] },
    expect: 404,
  });
  await run({
    title: 'пустая приёмка',
    method: 'post',
    url: `/api/requests/${ZERO}/confirm`,
    as: 'A',
    json: {},
    expect: 400,
  });
  await run({
    title: 'приёмка несуществующей',
    method: 'post',
    url: `/api/requests/${ZERO}/confirm`,
    as: 'A',
    json: { accepted: true },
    expect: 404,
  });

  // Документы
  await run({
    title: 'нет такого документа',
    method: 'post',
    url: `/api/requests/${ZERO}/documents/pdf/link`,
    as: 'A',
    expect: 404,
  });
  await run({
    title: 'ссылка на несуществующую',
    method: 'post',
    url: `/api/requests/${ZERO}/documents/claim/link`,
    as: 'A',
    expect: 404,
  });
  await run({
    title: 'PDF без входа',
    method: 'get',
    url: `/api/requests/${ZERO}/documents/claim.pdf`,
    expect: 401,
  });
  await run({
    title: 'PDF с неверной подписью',
    method: 'get',
    url: `/api/requests/${ZERO}/documents/gji.pdf?exp=${Date.now() + 60_000}&sig=00`,
    expect: 403,
  });

  // Фото
  await run({
    title: 'загрузка без входа',
    method: 'post',
    url: '/api/photos',
    multipart: { name: 'file', mime: 'image/png', bytes: PNG },
    expect: 401,
  });
  await run({
    title: 'загрузка не файлом',
    method: 'post',
    url: '/api/photos',
    as: 'A',
    json: {},
    expect: 406,
  });
  await run({
    title: 'нет такого фото',
    method: 'get',
    url: `/api/photos/aa/${'0'.repeat(64)}.jpg`,
    expect: 404,
  });

  // Демо-часы: на сервере проверки не двигаем
  await run({
    title: 'пустая перемотка',
    method: 'post',
    url: '/api/demo/clock',
    as: 'A',
    json: {},
    expect: [400, 404],
  });

  // Кабинет диспетчера
  await run({
    title: 'Б не диспетчер',
    method: 'get',
    url: '/api/dispatcher/inbox',
    as: 'B',
    expect: 403,
  });
  await run({
    title: 'Б без дома',
    method: 'post',
    url: '/api/demo/dispatcher',
    as: 'B',
    expect: [400, 404],
  });
  await run({
    title: 'А берёт роль диспетчера',
    method: 'post',
    url: '/api/demo/dispatcher',
    as: 'A',
    expect: [200, 404],
  });
  const inbox = (await run({
    title: 'входящие',
    method: 'get',
    url: '/api/dispatcher/inbox',
    as: 'A',
    expect: [200, 403],
  })) as Obj | undefined;
  const executors = list(
    await run({
      title: 'исполнители',
      method: 'get',
      url: '/api/dispatcher/executors',
      as: 'A',
      expect: [200, 403],
    }),
  );
  if (executors[0]) {
    await run({
      title: 'приглашение (ссылку не печатаем)',
      method: 'get',
      url: `/api/dispatcher/executors/${executors[0].id}/invite`,
      as: 'A',
      expect: [200, 503],
    });
  }
  await run({
    title: 'нет такого исполнителя',
    method: 'get',
    url: '/api/dispatcher/executors/no-such/invite',
    as: 'A',
    expect: [404, 403],
  });
  for (const action of ['accept', 'reject', 'assign', 'start', 'complete']) {
    await run({
      title: `пустое «${action}»`,
      method: 'post',
      url: `/api/dispatcher/${action}`,
      as: 'A',
      json: {},
      expect: [400, 403],
    });
  }
  await run({
    title: 'принять несуществующую',
    method: 'post',
    url: '/api/dispatcher/accept',
    as: 'A',
    json: { requestIds: [ZERO] },
    expect: [404, 403],
  });

  // Карточка чужой, но своего дома заявки — если во входящих что-то есть. Только чтение.
  const clusters = list(inbox?.clusters);
  const someId = clusters.flatMap((c) => (c.requestIds as string[] | undefined) ?? [])[0];
  if (someId) {
    const detail = (await run({
      title: 'карточка заявки дома',
      method: 'get',
      url: `/api/requests/${someId}`,
      as: 'A',
      expect: 200,
    })) as Obj | undefined;
    await run({
      title: 'чужой дом не видит',
      method: 'get',
      url: `/api/requests/${someId}`,
      as: 'B',
      expect: 403,
    });
    await run({
      title: 'ссылка на PDF — не автор',
      method: 'post',
      url: `/api/requests/${someId}/documents/claim/link`,
      as: 'A',
      expect: 403,
    });
    await run({
      title: 'приёмка — не автор',
      method: 'post',
      url: `/api/requests/${someId}/confirm`,
      as: 'A',
      json: { accepted: true },
      expect: 403,
    });
    const photo = list(detail?.photos)[0]?.url as string | undefined;
    if (photo?.startsWith('/api/photos/')) {
      await run({ title: 'фото из карточки', method: 'get', url: photo, expect: 200 });
    }
  }

  if (writes) await fullScenario(houseId, categories, executors);
}

/** Полный сценарий с записью — только локально: создаёт заявку и проводит её до приёмки. */
async function fullScenario(houseId: string, categories: Obj[], executors: Obj[]) {
  console.log('\nПолный сценарий:');
  const heating = categories.find((c) => c.code === 'heating') ?? categories[0];
  await run({
    title: 'Б выбирает дом',
    method: 'post',
    url: '/api/me/house',
    as: 'B',
    json: { houseId, apartmentLabel: 'кв. 9998' },
    expect: 200,
  });

  const upload = (await run({
    title: 'загрузка фото',
    method: 'post',
    url: '/api/photos',
    as: 'A',
    multipart: { name: 'file', mime: 'image/png', bytes: PNG },
    expect: 200,
  })) as Obj;
  await run({ title: 'фото по ключу', method: 'get', url: String(upload.url), expect: 200 });

  const started = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const created = (await run({
    title: 'подать заявку',
    method: 'post',
    url: '/api/requests',
    as: 'A',
    json: {
      category: heating?.code,
      location: { scope: 'apartment' },
      description: 'Проверка openapi.yaml',
      startedAt: started,
      measurements: [{ value: 15, unit: 'celsius', measuredAt: started, place: 'room' }],
      plannedNotice: null,
      photoKeys: [upload.key],
    },
    expect: 200,
  })) as Obj;
  const id = String(created.id);

  await run({ title: 'мои заявки', method: 'get', url: '/api/requests', as: 'A', expect: 200 });
  await run({
    title: 'Б видит карточку',
    method: 'get',
    url: `/api/requests/${id}`,
    as: 'B',
    expect: 200,
  });
  await run({
    title: 'Б: «У меня тоже»',
    method: 'post',
    url: `/api/requests/${id}/join`,
    as: 'B',
    json: { apartmentLabel: 'кв. 9998', measurements: [] },
    expect: 200,
  });
  await run({
    title: 'Б повторно',
    method: 'post',
    url: `/api/requests/${id}/join`,
    as: 'B',
    json: { apartmentLabel: 'кв. 9998', measurements: [] },
    expect: 409,
  });
  await run({
    title: 'приёмка до выполнения',
    method: 'post',
    url: `/api/requests/${id}/confirm`,
    as: 'A',
    json: { accepted: true },
    expect: 409,
  });

  const claim = (await run({
    title: 'ссылка на заявление',
    method: 'post',
    url: `/api/requests/${id}/documents/claim/link`,
    as: 'A',
    expect: 200,
  })) as Obj;
  await run({ title: 'заявление по ссылке', method: 'get', url: String(claim.url), expect: 200 });
  await run({
    title: 'заявление с входом',
    method: 'get',
    url: `/api/requests/${id}/documents/claim.pdf`,
    as: 'A',
    expect: 200,
  });
  await run({
    title: 'заявление — сосед',
    method: 'get',
    url: `/api/requests/${id}/documents/claim.pdf`,
    as: 'B',
    expect: 403,
  });
  await run({
    title: 'ГЖИ до срока',
    method: 'post',
    url: `/api/requests/${id}/documents/gji/link`,
    as: 'A',
    expect: 409,
  });
  await run({
    title: 'ГЖИ до срока',
    method: 'get',
    url: `/api/requests/${id}/documents/gji.pdf`,
    as: 'A',
    expect: 409,
  });

  await run({
    title: 'перемотка +72 ч',
    method: 'post',
    url: '/api/demo/clock',
    as: 'A',
    json: { shiftHours: 72 },
    expect: 200,
  });
  const gji = (await run({
    title: 'ссылка на ГЖИ',
    method: 'post',
    url: `/api/requests/${id}/documents/gji/link`,
    as: 'A',
    expect: 200,
  })) as Obj;
  await run({ title: 'ГЖИ по ссылке', method: 'get', url: String(gji.url), expect: 200 });
  await run({
    title: 'сброс часов',
    method: 'post',
    url: '/api/demo/clock',
    as: 'A',
    json: { reset: true },
    expect: 200,
  });

  await run({
    title: 'входящие',
    method: 'get',
    url: '/api/dispatcher/inbox',
    as: 'A',
    expect: 200,
  });
  await run({
    title: 'принять',
    method: 'post',
    url: '/api/dispatcher/accept',
    as: 'A',
    json: { requestIds: [id] },
    expect: 200,
  });
  const worker =
    executors.find((e) => list(e.categories).includes(heating?.code as never)) ?? executors[0];
  const stranger = executors.find((e) => !list(e.categories).includes(heating?.code as never));
  if (stranger) {
    await run({
      title: 'назначить не того',
      method: 'post',
      url: '/api/dispatcher/assign',
      as: 'A',
      json: { requestIds: [id], executorId: stranger.id },
      expect: 409,
    });
  }
  await run({
    title: 'назначить',
    method: 'post',
    url: '/api/dispatcher/assign',
    as: 'A',
    json: {
      requestIds: [id],
      executorId: worker?.id,
      plannedAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    expect: 200,
  });
  await run({
    title: 'приступил',
    method: 'post',
    url: '/api/dispatcher/start',
    as: 'A',
    json: { requestIds: [id] },
    expect: 200,
  });
  await run({
    title: 'выполнено',
    method: 'post',
    url: '/api/dispatcher/complete',
    as: 'A',
    json: { requestIds: [id] },
    expect: 200,
  });
  await run({
    title: 'житель принимает',
    method: 'post',
    url: `/api/requests/${id}/confirm`,
    as: 'A',
    json: { accepted: true },
    expect: 200,
  });

  // Отказ — на второй заявке другой категории (в подъезде), чтобы не сработала защита от дублей
  const other = categories.find((c) => c.zone === 'entrance') ?? categories[1];
  const second = (await run({
    title: 'вторая заявка',
    method: 'post',
    url: '/api/requests',
    as: 'A',
    json: {
      category: other?.code,
      location: { scope: 'entrance', entrance: 1 },
      description: 'Проверка openapi.yaml',
      startedAt: new Date().toISOString(),
      measurements: [],
      plannedNotice: null,
      photoKeys: [],
    },
    expect: 200,
  })) as Obj;
  await run({
    title: 'отклонить',
    method: 'post',
    url: '/api/dispatcher/reject',
    as: 'A',
    json: { requestIds: [second.id], reason: 'Проверка' },
    expect: 200,
  });
}

// ── Запуск ────────────────────────────────────────────────────────────────────────────

try {
  await scenario();
} catch (err) {
  failures++;
  console.log(`✗ проверка прервалась: ${(err as Error).message}`);
} finally {
  console.log('\nУборка:');
  await run({
    title: 'удалить данные А',
    method: 'delete',
    url: '/api/me',
    as: 'A',
    expect: 200,
  }).catch(() => failures++);
  await run({
    title: 'удалить данные Б',
    method: 'delete',
    url: '/api/me',
    as: 'B',
    expect: 200,
  }).catch(() => failures++);
}

// Какие маршруты из openapi.yaml ни разу не ответили успехом
const all = Object.entries(doc.paths).flatMap(([p, ops]) =>
  Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`),
);
const noSuccess = all.filter((k) => !coverage.get(k)?.has(200));
console.log(
  `\nМаршрутов в openapi.yaml: ${all.length}, вызвано: ${coverage.size}, с ответом 200: ${all.length - noSuccess.length}`,
);
if (noSuccess.length) {
  console.log(`Без ответа 200${writes ? '' : ' (на сервере проверки не создаём данные)'}:`);
  for (const k of noSuccess)
    console.log(`  ${k}  коды: ${[...(coverage.get(k) ?? [])].join(', ') || '—'}`);
}
console.log(failures ? `\nРасхождений: ${failures}` : '\nРасхождений с openapi.yaml нет');
process.exit(failures ? 1 : 0);
