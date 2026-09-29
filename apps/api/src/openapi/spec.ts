/**
 * Описание HTTP API в формате OpenAPI 3.1.
 *
 * Схемы запросов и ответов не пишутся здесь заново — они берутся из тех же zod-контрактов
 * (`@msc/domain`), которыми API проверяет входные данные, а мини-приложение — ответы.
 * Поэтому поля и типы в openapi.yaml совпадают с реальными по построению. Руками здесь
 * описаны только маршруты: метод, путь, нужен ли вход и какие коды ответа возможны.
 *
 * Сгенерировать файл: pnpm --filter @msc/api openapi
 * Проверить на живом сервере: pnpm --filter @msc/api check-openapi
 */
import {
  AcceptInputSchema,
  ApiErrorBodySchema,
  AssignInputSchema,
  BindHouseInputSchema,
  BulkResultSchema,
  CategorySchema,
  ClusterCardSchema,
  CompleteInputSchema,
  ConfirmInputSchema,
  ContactKindSchema,
  ContactSchema,
  DeleteMeResultSchema,
  DemoClockInputSchema,
  DemoClockStateSchema,
  DispatcherInboxSchema,
  ExecutorInviteSchema,
  ExecutorSchema,
  HomeSchema,
  HouseSearchItemSchema,
  IsoDateTime,
  JoinerPublicSchema,
  JoinInputSchema,
  LiabilitySchema,
  LiabilityStepSchema,
  LocationSchema,
  LocationScopeSchema,
  MeasurementPlaceSchema,
  MeasurementSchema,
  MeSchema,
  MyDataSchema,
  NewRequestInputSchema,
  NormRefSchema,
  ProvenanceSchema,
  RejectInputSchema,
  RequestDetailSchema,
  RequestEventSchema,
  RequestKindSchema,
  RequestStatusSchema,
  RequestSummarySchema,
  RoleSchema,
  ScheduleSchema,
  ServiceSchema,
  StoredItemSchema,
} from '@msc/domain';
import { stringify } from 'yaml';
import * as z from 'zod';

// ── Схемы ответов, у которых нет отдельного контракта в @msc/domain ─────────────────────

export const HealthSchema = z.object({ ok: z.literal(true), now: IsoDateTime });
export const PhotoUploadSchema = z.object({ key: z.string(), url: z.string() });
export const DocumentLinkSchema = z.object({ url: z.string(), expiresAt: IsoDateTime });
export const DemoDispatcherSchema = z.object({
  role: z.literal('dispatcher'),
  orgId: z.string(),
  orgName: z.string(),
});

/** Имя схемы в components.schemas → сама схема. Порядок важен: вложенные — раньше. */
export const namedSchemas = {
  Provenance: ProvenanceSchema,
  Role: RoleSchema,
  Service: ServiceSchema,
  RequestKind: RequestKindSchema,
  RequestStatus: RequestStatusSchema,
  LocationScope: LocationScopeSchema,
  MeasurementPlace: MeasurementPlaceSchema,
  ContactKind: ContactKindSchema,
  NormRef: NormRefSchema,
  ApiError: ApiErrorBodySchema,
  Health: HealthSchema,
  HouseSearchItem: HouseSearchItemSchema,
  Schedule: ScheduleSchema,
  Contact: ContactSchema,
  Home: HomeSchema,
  Category: CategorySchema,
  Me: MeSchema,
  BindHouseInput: BindHouseInputSchema,
  StoredItem: StoredItemSchema,
  MyData: MyDataSchema,
  DeleteMeResult: DeleteMeResultSchema,
  Measurement: MeasurementSchema,
  Location: LocationSchema,
  LiabilityStep: LiabilityStepSchema,
  Liability: LiabilitySchema,
  RequestEvent: RequestEventSchema,
  JoinerPublic: JoinerPublicSchema,
  NewRequestInput: NewRequestInputSchema,
  RequestSummary: RequestSummarySchema,
  RequestDetail: RequestDetailSchema,
  JoinInput: JoinInputSchema,
  ConfirmInput: ConfirmInputSchema,
  DocumentLink: DocumentLinkSchema,
  PhotoUpload: PhotoUploadSchema,
  DemoClockState: DemoClockStateSchema,
  DemoClockInput: DemoClockInputSchema,
  DemoDispatcher: DemoDispatcherSchema,
  ClusterCard: ClusterCardSchema,
  DispatcherInbox: DispatcherInboxSchema,
  Executor: ExecutorSchema,
  ExecutorInvite: ExecutorInviteSchema,
  AcceptInput: AcceptInputSchema,
  RejectInput: RejectInputSchema,
  AssignInput: AssignInputSchema,
  CompleteInput: CompleteInputSchema,
  BulkResult: BulkResultSchema,
} as const;

export type SchemaName = keyof typeof namedSchemas;

// ── Маршруты ──────────────────────────────────────────────────────────────────────────

/** Что возвращает маршрут при успехе (200). */
export type Success =
  | { json: SchemaName; array?: boolean }
  | { binary: 'application/pdf' | 'image/*'; description: string };

export interface RouteSpec {
  method: 'get' | 'post' | 'delete';
  /** Путь в нотации OpenAPI: /api/requests/{id} */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /**
   * required — нужен заголовок X-Init-Data; none — открытый маршрут;
   * header-or-signature — X-Init-Data или подписанная ссылка (?exp&sig).
   */
  auth: 'required' | 'none' | 'header-or-signature';
  params?: Record<string, string>;
  query?: Array<{ name: string; description: string; required: boolean; schema: object }>;
  body?: SchemaName;
  multipart?: boolean;
  success: Success;
  /** Коды ошибок, которые маршрут может вернуть (тело всегда ApiError). */
  errors: number[];
  /** Только при DEMO_MODE=1; иначе маршрута нет (404). */
  demoOnly?: boolean;
}

const ID = 'Идентификатор (UUID из ответов API)';

export const routes: RouteSpec[] = [
  // Служебное
  {
    method: 'get',
    path: '/api/health',
    tag: 'Служебное',
    summary: 'Проверка живости сервера',
    auth: 'none',
    success: { json: 'Health' },
    errors: [],
  },

  // Дома — открытые справочные маршруты
  {
    method: 'get',
    path: '/api/houses',
    tag: 'Дома',
    summary: 'Поиск дома по адресу',
    description: 'Без учёта регистра, от 3 символов.',
    auth: 'none',
    query: [
      {
        name: 'q',
        description: 'Часть адреса, от 3 до 100 символов',
        required: true,
        schema: { type: 'string', minLength: 3, maxLength: 100 },
      },
    ],
    success: { json: 'HouseSearchItem', array: true },
    errors: [400, 429],
  },
  {
    method: 'get',
    path: '/api/houses/{id}/home',
    tag: 'Дома',
    summary: 'Экран «Мой дом»: УК, контакты с признаком «открыто сейчас», объявление',
    auth: 'none',
    params: { id: 'Идентификатор дома, например house-16-kazan-001' },
    success: { json: 'Home' },
    errors: [404, 429],
  },
  {
    method: 'get',
    path: '/api/houses/{id}/categories',
    tag: 'Дома',
    summary: 'Категории заявок для региона дома',
    auth: 'none',
    params: { id: 'Идентификатор дома' },
    success: { json: 'Category', array: true },
    errors: [404, 429],
  },

  // Пользователь
  {
    method: 'get',
    path: '/api/me',
    tag: 'Пользователь',
    summary: 'Кто вошёл: профиль MAX, роль, дом',
    description: 'Первый вызов создаёт пользователя.',
    auth: 'required',
    success: { json: 'Me' },
    errors: [401, 429],
  },
  {
    method: 'post',
    path: '/api/me/house',
    tag: 'Пользователь',
    summary: 'Привязка к дому и квартире',
    auth: 'required',
    body: 'BindHouseInput',
    success: { json: 'Me' },
    errors: [400, 401, 404, 429],
  },
  {
    method: 'get',
    path: '/api/me/data',
    tag: 'Пользователь',
    summary: 'Какие данные о пользователе хранятся и зачем',
    auth: 'required',
    success: { json: 'MyData' },
    errors: [401, 404, 429],
  },
  {
    method: 'delete',
    path: '/api/me',
    tag: 'Пользователь',
    summary: 'Удалить свои данные',
    description:
      'Удаляет привязки, согласия, присоединения и очередь уведомлений. Заявки не удаляются, а обезличиваются.',
    auth: 'required',
    success: { json: 'DeleteMeResult' },
    errors: [401, 429],
  },

  // Заявки жителя
  {
    method: 'get',
    path: '/api/requests',
    tag: 'Заявки',
    summary: 'Мои заявки: поданные и те, к которым я присоединился',
    auth: 'required',
    success: { json: 'RequestSummary', array: true },
    errors: [401, 429],
  },
  {
    method: 'post',
    path: '/api/requests',
    tag: 'Заявки',
    summary: 'Подать заявку',
    description:
      'Срок ответа считается по норме от момента подачи. Повтор той же категории в течение DUPLICATE_WINDOW_MIN возвращает уже созданную заявку.',
    auth: 'required',
    body: 'NewRequestInput',
    success: { json: 'RequestDetail' },
    errors: [400, 401, 404, 429],
  },
  {
    method: 'get',
    path: '/api/requests/{id}',
    tag: 'Заявки',
    summary: 'Карточка заявки',
    description: 'Доступна автору и жителям того же дома.',
    auth: 'required',
    params: { id: ID },
    success: { json: 'RequestDetail' },
    errors: [401, 403, 404, 429],
  },
  {
    method: 'post',
    path: '/api/requests/{id}/join',
    tag: 'Заявки',
    summary: '«У меня тоже»: сосед присоединяется к заявке',
    auth: 'required',
    params: { id: ID },
    body: 'JoinInput',
    success: { json: 'RequestDetail' },
    errors: [400, 401, 403, 404, 409, 429],
  },
  {
    method: 'post',
    path: '/api/requests/{id}/confirm',
    tag: 'Заявки',
    summary: 'Житель принимает работу или возвращает её',
    auth: 'required',
    params: { id: ID },
    body: 'ConfirmInput',
    success: { json: 'RequestDetail' },
    errors: [400, 401, 403, 404, 409, 429],
  },

  // Документы
  {
    method: 'post',
    path: '/api/requests/{id}/documents/{kind}/link',
    tag: 'Документы',
    summary: 'Временная подписанная ссылка на PDF',
    description:
      'Нужна, потому что мини-приложение открывает PDF обычным переходом без заголовка X-Init-Data.',
    auth: 'required',
    params: {
      id: ID,
      kind: 'claim — заявление о перерасчёте; gji — обращение в жилищную инспекцию',
    },
    success: { json: 'DocumentLink' },
    errors: [401, 403, 404, 409, 429],
  },
  {
    method: 'get',
    path: '/api/requests/{id}/documents/claim.pdf',
    tag: 'Документы',
    summary: 'Заявление о перерасчёте (PDF)',
    description: 'Доступно автору заявки, когда насчитан перерасчёт.',
    auth: 'header-or-signature',
    params: { id: ID },
    success: { binary: 'application/pdf', description: 'PDF-документ' },
    errors: [401, 403, 404, 409, 429],
  },
  {
    method: 'get',
    path: '/api/requests/{id}/documents/gji.pdf',
    tag: 'Документы',
    summary: 'Обращение в жилищную инспекцию (PDF)',
    description: 'Доступно автору после истечения срока ответа управляющей организации.',
    auth: 'header-or-signature',
    params: { id: ID },
    success: { binary: 'application/pdf', description: 'PDF-документ' },
    errors: [401, 403, 404, 409, 429],
  },

  // Фото
  {
    method: 'post',
    path: '/api/photos',
    tag: 'Фото',
    summary: 'Загрузить фото к будущей заявке',
    description: 'multipart/form-data, поле file; JPEG, PNG, WebP или HEIC до 5 МБ.',
    auth: 'required',
    multipart: true,
    success: { json: 'PhotoUpload' },
    errors: [400, 401, 406, 429],
  },
  {
    method: 'get',
    path: '/api/photos/{dir}/{file}',
    tag: 'Фото',
    summary: 'Отдать фото по ключу',
    description:
      'Ключ из ответа загрузки или карточки заявки: <2 символа>/<хеш>.<расширение>. Открыт без входа: ключ неугадываемый.',
    auth: 'none',
    params: { dir: 'Первые 2 символа хеша', file: 'Имя файла: хеш и расширение' },
    success: { binary: 'image/*', description: 'Изображение' },
    errors: [404, 429],
  },

  // Демо-режим
  {
    method: 'get',
    path: '/api/demo/clock',
    tag: 'Демо-режим',
    summary: 'Текущий сдвиг демо-часов',
    auth: 'none',
    demoOnly: true,
    success: { json: 'DemoClockState' },
    errors: [404, 429],
  },
  {
    method: 'post',
    path: '/api/demo/clock',
    tag: 'Демо-режим',
    summary: 'Перемотать или сбросить демо-часы',
    auth: 'required',
    demoOnly: true,
    body: 'DemoClockInput',
    success: { json: 'DemoClockState' },
    errors: [400, 401, 404, 429],
  },
  {
    method: 'post',
    path: '/api/demo/dispatcher',
    tag: 'Демо-режим',
    summary: 'Взять роль диспетчера УК своего дома',
    description: 'Чтобы жюри прошло сценарий одним аккаунтом.',
    auth: 'required',
    demoOnly: true,
    success: { json: 'DemoDispatcher' },
    errors: [400, 401, 404, 429],
  },

  // Кабинет диспетчера
  {
    method: 'get',
    path: '/api/dispatcher/inbox',
    tag: 'Диспетчер',
    summary: 'Входящие, сгруппированные по причинам, со сроками и ценой простоя',
    auth: 'required',
    success: { json: 'DispatcherInbox' },
    errors: [401, 403, 429],
  },
  {
    method: 'get',
    path: '/api/dispatcher/executors',
    tag: 'Диспетчер',
    summary: 'Исполнители своей УК',
    auth: 'required',
    success: { json: 'Executor', array: true },
    errors: [401, 403, 429],
  },
  {
    method: 'get',
    path: '/api/dispatcher/executors/{id}/invite',
    tag: 'Диспетчер',
    summary: 'Ссылка-приглашение исполнителя в бот',
    auth: 'required',
    params: { id: 'Идентификатор исполнителя' },
    success: { json: 'ExecutorInvite' },
    errors: [401, 403, 404, 429, 503],
  },
  {
    method: 'post',
    path: '/api/dispatcher/accept',
    tag: 'Диспетчер',
    summary: 'Принять заявки',
    auth: 'required',
    body: 'AcceptInput',
    success: { json: 'BulkResult' },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'post',
    path: '/api/dispatcher/reject',
    tag: 'Диспетчер',
    summary: 'Отклонить заявки с причиной',
    auth: 'required',
    body: 'RejectInput',
    success: { json: 'BulkResult' },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'post',
    path: '/api/dispatcher/assign',
    tag: 'Диспетчер',
    summary: 'Назначить исполнителя и плановое время',
    description:
      'Исполнителю в боте уходит наряд. 409 — исполнитель не выполняет работы этой категории.',
    auth: 'required',
    body: 'AssignInput',
    success: { json: 'BulkResult' },
    errors: [400, 401, 403, 404, 409, 429],
  },
  {
    method: 'post',
    path: '/api/dispatcher/start',
    tag: 'Диспетчер',
    summary: 'Отметить, что исполнитель приступил',
    auth: 'required',
    body: 'AcceptInput',
    success: { json: 'BulkResult' },
    errors: [400, 401, 403, 404, 429],
  },
  {
    method: 'post',
    path: '/api/dispatcher/complete',
    tag: 'Диспетчер',
    summary: 'Отметить выполненными',
    auth: 'required',
    body: 'CompleteInput',
    success: { json: 'BulkResult' },
    errors: [400, 401, 403, 404, 429],
  },
];

// ── Сборка документа ──────────────────────────────────────────────────────────────────

const errorText: Record<number, string> = {
  400: 'Неверные входные данные',
  401: 'Нет или недействителен вход через MAX (заголовок X-Init-Data)',
  403: 'Нет доступа: чужой дом, не автор заявки или не диспетчер',
  404: 'Не найдено',
  409: 'Действие недопустимо в текущем состоянии заявки',
  406: 'Тело запроса не multipart/form-data',
  413: 'Тело запроса больше 1 МБ',
  415: 'Тело запроса не application/json',
  429: 'Слишком много запросов: больше RATE_LIMIT_MAX в минуту',
  503: 'Функция не настроена на сервере',
};

const tagText: Record<string, string> = {
  Служебное: 'Проверка, что сервер работает',
  Дома: 'Справочник домов, управляющих организаций и категорий заявок — без входа',
  Пользователь: 'Профиль, привязка к дому, просмотр и удаление своих данных',
  Заявки: 'Заявки жителя, «У меня тоже» и приёмка работы',
  Документы: 'PDF: заявление о перерасчёте и обращение в жилищную инспекцию',
  Фото: 'Загрузка и выдача фотографий к заявкам',
  'Демо-режим': 'Перемотка времени и роль диспетчера одним аккаунтом — только при DEMO_MODE=1',
  Диспетчер: 'Кабинет диспетчера УК: входящие по причинам, исполнители, массовые действия',
};

/** Компоненты с общими схемами. $schema и $id убираем — в OpenAPI они не нужны. */
function componentSchemas(): Record<string, object> {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of Object.entries(namedSchemas)) registry.add(schema, { id });
  const { schemas } = z.toJSONSchema(registry, {
    uri: (id) => `#/components/schemas/${id}`,
    // Схемы ответов не содержат значений по умолчанию, поэтому режим «вход» годится для обоих
    // направлений и не добавляет additionalProperties: false — лишнее поле не ломает клиента.
    io: 'input',
  });
  const cleaned: Record<string, object> = {};
  for (const [id, s] of Object.entries(schemas)) {
    const { $schema: _s, $id: _i, ...rest } = s as Record<string, unknown>;
    cleaned[id] = simplify(rest) as object;
  }
  return cleaned;
}

/**
 * Убирает шум, который не несёт смысла для читателя: регулярку даты рядом с format: date-time
 * (формат и так сказан, а «только UTC» — в описании API) и границы ±2^53 у целых чисел.
 */
function simplify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplify);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'pattern' && (node as { format?: string }).format === 'date-time') continue;
    if (k === 'maximum' && v === Number.MAX_SAFE_INTEGER) continue;
    if (k === 'minimum' && v === Number.MIN_SAFE_INTEGER) continue;
    out[k] = simplify(v);
  }
  return out;
}

const ref = (name: SchemaName) => ({ $ref: `#/components/schemas/${name}` });

function operation(r: RouteSpec) {
  const parameters: object[] = [];
  const pathParams = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
  for (const name of pathParams) {
    parameters.push({
      name,
      in: 'path',
      required: true,
      description: r.params?.[name] ?? '',
      schema: name === 'kind' ? { type: 'string', enum: ['claim', 'gji'] } : { type: 'string' },
    });
  }
  for (const q of r.query ?? []) {
    parameters.push({
      name: q.name,
      in: 'query',
      required: q.required,
      description: q.description,
      schema: q.schema,
    });
  }
  if (r.auth === 'header-or-signature') {
    parameters.push(
      {
        name: 'exp',
        in: 'query',
        required: false,
        description: 'Срок ссылки, мс (из /link)',
        schema: { type: 'string' },
      },
      {
        name: 'sig',
        in: 'query',
        required: false,
        description: 'Подпись ссылки (из /link)',
        schema: { type: 'string' },
      },
    );
  }

  const success =
    'json' in r.success
      ? {
          description: 'Успех',
          content: {
            'application/json': {
              schema: r.success.array
                ? { type: 'array', items: ref(r.success.json) }
                : ref(r.success.json),
            },
          },
        }
      : {
          description: r.success.description,
          content: { [r.success.binary]: { schema: { type: 'string', format: 'binary' } } },
        };

  // Тело JSON разбирает сам Fastify: слишком большое — 413, не JSON — 415
  const errors = r.body ? [...new Set([...r.errors, 413, 415])].sort((a, b) => a - b) : r.errors;
  const responses: Record<string, object> = { '200': success };
  for (const code of errors) responses[String(code)] = { $ref: `#/components/responses/E${code}` };
  responses['500'] = { $ref: '#/components/responses/E500' };

  const op: Record<string, unknown> = {
    tags: [r.tag],
    summary: r.summary,
    operationId: `${r.method}${r.path.replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
    responses,
  };
  const notes = [
    r.description,
    r.demoOnly ? 'Только при DEMO_MODE=1, иначе 404.' : undefined,
  ].filter(Boolean);
  if (notes.length) op.description = notes.join(' ');
  if (parameters.length) op.parameters = parameters;
  if (r.auth === 'required') op.security = [{ initData: [] }];
  if (r.auth === 'header-or-signature') op.security = [{ initData: [] }, {}];
  if (r.auth === 'none') op.security = [];
  if (r.body) {
    op.requestBody = { required: true, content: { 'application/json': { schema: ref(r.body) } } };
  }
  if (r.multipart) {
    op.requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { file: { type: 'string', format: 'binary' } },
            required: ['file'],
          },
        },
      },
    };
  }
  return op;
}

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    paths[r.path] ??= {};
    (paths[r.path] as Record<string, unknown>)[r.method] = operation(r);
  }

  const errorResponses: Record<string, object> = {};
  for (const code of [...Object.keys(errorText).map(Number), 500]) {
    errorResponses[`E${code}`] = {
      description: errorText[code] ?? 'Внутренняя ошибка сервера',
      content: { 'application/json': { schema: ref('ApiError') } },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'Одна заявка на весь дом — API мини-приложения',
      version: '1.0.0',
      description: [
        'HTTP API, которое обслуживает мини-приложение в MAX. Отдельным продуктом для внешних систем не является.',
        '',
        'Вход — по подписи MAX: мини-приложение передаёт initData в заголовке X-Init-Data, сервер проверяет',
        'HMAC-подпись токеном бота и свежесть данных. Для проверки без MAX подписанную initData тестового',
        'пользователя печатает `pnpm --filter @msc/api sign-init-data` (нужен тот же BOT_TOKEN, что у сервера).',
        '',
        'Ошибки всегда в одном формате: {"error": {"code": "...", "message": "..."}}.',
        'Время — ISO 8601 в UTC, деньги — целые копейки.',
      ].join('\n'),
    },
    servers: [
      { url: 'https://belyaevmaxim.ru', description: 'Сервер на период проверки' },
      { url: 'http://localhost:3001', description: 'Локальный запуск' },
    ],
    tags: [...new Set(routes.map((r) => r.tag))].map((name) => ({
      name,
      description: tagText[name] ?? name,
    })),
    paths,
    components: {
      securitySchemes: {
        initData: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Init-Data',
          description: 'Данные запуска мини-приложения MAX (initData) с HMAC-подписью.',
        },
      },
      responses: errorResponses,
      schemas: componentSchemas(),
    },
  };
}

/** Где лежит openapi.yaml: в корне репозитория. */
export const openApiFile = new URL('../../../../openapi.yaml', import.meta.url);

/** Текст openapi.yaml. Один и тот же при каждом запуске — тест сверяет его с файлом в репозитории. */
export function renderOpenApiYaml(): string {
  const header = [
    '# Сгенерировано из zod-контрактов (packages/domain) и списка маршрутов',
    '# (apps/api/src/openapi/spec.ts). Руками не править: pnpm --filter @msc/api openapi',
    '',
  ].join('\n');
  return header + stringify(buildOpenApi(), { lineWidth: 0, aliasDuplicateObjects: false });
}
