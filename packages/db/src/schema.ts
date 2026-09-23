import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// Общие куски колонок
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// Номер заявки «2026-0142» берётся из последовательности, а не из count(*):
// при двух одновременных заявках count выдал бы одинаковый номер.
export const requestNumberSeq = pgSequence('request_number_seq', { startWith: 1 });

// ─── Люди и доступ ────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: id(),
  // HMAC(max_user_id, секрет) — по нему ищем пользователя; необратим
  userHash: text('user_hash').notNull().unique(),
  // AES-GCM(max_user_id) — нужен, чтобы outbox мог написать человеку в MAX
  userIdEnc: text('user_id_enc').notNull(),
  createdAt: createdAt(),
});

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(), // из regions/<код>/orgs.yaml
  type: text('type', { enum: ['uk', 'contractor'] }).notNull(),
  name: text('name').notNull(),
  inn: text('inn'),
  regionCode: text('region_code').notNull(),
  dataKind: text('data_kind', { enum: ['real', 'model'] }).notNull(),
});

export const houses = pgTable('houses', {
  id: text('id').primaryKey(), // из regions/<код>/houses.yaml
  fiasId: text('fias_id'),
  address: text('address').notNull(),
  regionCode: text('region_code').notNull(),
  tz: text('tz').notNull(), // 'Europe/Moscow' — от него зависят «открыто сейчас» и ночная норма
  orgId: text('org_id').references(() => organizations.id),
  dataKind: text('data_kind', { enum: ['real', 'model'] }).notNull(),
});

export const contacts = pgTable('contacts', {
  id: id(),
  houseId: text('house_id')
    .notNull()
    .references(() => houses.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['office', 'dispatcher', 'emergency'] }).notNull(),
  phone: text('phone').notNull(),
  schedule: jsonb('schedule'),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['resident', 'dispatcher', 'executor'] }).notNull(),
    houseId: text('house_id').references(() => houses.id),
    orgId: text('org_id').references(() => organizations.id),
    apartmentLabel: text('apartment_label'), // «кв. 45», без ФИО
    confirmed: boolean('confirmed').notNull().default(false),
    // для расчёта перерасчёта; пусто — расчёт подставляет допущение и помечает шаг как модель
    apartmentAreaM2: doublePrecision('apartment_area_m2'),
    residents: integer('residents'),
    monthlyChargeKopecks: integer('monthly_charge_kopecks'),
    createdAt: createdAt(),
  },
  (t) => [
    index('memberships_user_idx').on(t.userId),
    check('memberships_scope_chk', sql`${t.houseId} is not null or ${t.orgId} is not null`),
  ],
);

export const consents = pgTable('consents', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  docType: text('doc_type').notNull(),
  docVersion: text('doc_version').notNull(),
  docSha256: text('doc_sha256').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
});

export const executors = pgTable('executors', {
  id: id(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id),
  userId: text('user_id').references(() => users.id),
  nameShort: text('name_short').notNull(), // «Иванов И.»
  categories: jsonb('categories').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
});

// ─── Заявки ───────────────────────────────────────────────────────────────────

export const requests = pgTable(
  'requests',
  {
    id: id(),
    number: text('number').notNull().unique(), // '2026-0142' — его называют в разговоре с УК
    houseId: text('house_id')
      .notNull()
      .references(() => houses.id),
    authorUserId: text('author_user_id')
      .notNull()
      .references(() => users.id),
    category: text('category').notNull(), // код из regions/<код>/categories.yaml
    kind: text('kind', {
      enum: ['emergency', 'repair', 'utility_quality', 'utility_interruption'],
    }).notNull(),
    service: text('service'), // heating | hot_water | cold_water; у ремонта NULL
    location: jsonb('location').notNull(), // { scope, entrance?, floor?, note? }
    description: text('description').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(), // когда началось, а не когда подали
    endedAt: timestamp('ended_at', { withTimezone: true }), // NULL — пока не устранено
    plannedNotice: boolean('planned_notice'),
    accident: boolean('accident').notNull().default(false),
    status: text('status').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    clusterId: text('cluster_id'),
    executorId: text('executor_id').references(() => executors.id),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('requests_house_status_idx').on(t.houseId, t.status),
    index('requests_due_idx').on(t.dueAt),
    index('requests_cluster_idx').on(t.clusterId),
  ],
);

// История заявки: только добавление, строки не меняются и не удаляются.
export const requestEvents = pgTable(
  'request_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorUserId: text('actor_user_id').references(() => users.id), // NULL — система
    payload: jsonb('payload').notNull().default({}),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('request_events_request_at_idx').on(t.requestId, t.at)],
);

// «У меня тоже»: один человек присоединяется к заявке один раз.
export const joins = pgTable(
  'joins',
  {
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    apartmentLabel: text('apartment_label').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.userId] })],
);

// Замеры: joinerUserId = NULL — замер автора заявки, иначе — соседа из joins.
export const measurements = pgTable(
  'measurements',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    joinerUserId: text('joiner_user_id'),
    value: doublePrecision('value').notNull(),
    unit: text('unit').notNull(), // celsius
    measuredAt: timestamp('measured_at', { withTimezone: true }).notNull(),
    place: text('place', { enum: ['room', 'corner_room', 'tap'] }).notNull(),
  },
  (t) => [
    index('measurements_request_idx').on(t.requestId),
    foreignKey({
      columns: [t.requestId, t.joinerUserId],
      foreignColumns: [joins.requestId, joins.userId],
    }).onDelete('cascade'),
  ],
);

export const photos = pgTable(
  'photos',
  {
    id: id(),
    // NULL — фото загружено раньше, чем создана заявка (форма отправляется после загрузки)
    requestId: text('request_id').references(() => requests.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    stage: text('stage', { enum: ['before', 'after'] }).notNull(),
    uploadedBy: text('uploaded_by').references(() => users.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('photos_request_idx').on(t.requestId)],
);

// ─── Служебное ────────────────────────────────────────────────────────────────

// Уведомления в бот. Пишутся в той же транзакции, что и смена статуса заявки.
export const outbox = pgTable(
  'outbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAt: timestamp('next_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [index('outbox_status_next_idx').on(t.status, t.nextAt)],
);

// Защита от повторной доставки апдейта MAX. В апдейтах MAX нет update_id,
// поэтому ключ собираем сами: 'msg:<mid>', 'cb:<callback_id>', 'start:<user_id>:<timestamp>'.
export const processedUpdates = pgTable('processed_updates', {
  updateKey: text('update_key').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

// Серверные демо-часы: ровно одна строка с id = 1.
export const demoClock = pgTable(
  'demo_clock',
  {
    id: smallint('id').primaryKey().default(1),
    offsetMs: bigint('offset_ms', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('demo_clock_single_row_chk', sql`${t.id} = 1`)],
);
