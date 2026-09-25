import { type DeleteMeResult, demoClockLabel, type MyData } from '@msc/domain';
import type {
  Category,
  Home,
  HouseSearchItem,
  JoinInput,
  Me,
  NewRequestInput,
  RequestDetail,
  RequestSummary,
} from './types';

const HOUSE_ID = 'house-16-kazan-001';
const HOUSE_ADDRESS = 'Казань, ул. Садовая, 12';
const BOT = import.meta.env.VITE_BOT_NAME || 'max_smart_city_bot';

const houses: HouseSearchItem[] = [
  { id: HOUSE_ID, address: HOUSE_ADDRESS, regionCode: '16', dataKind: 'model' },
  {
    id: 'house-16-kazan-002',
    address: 'Казань, ул. Центральная, 5',
    regionCode: '16',
    dataKind: 'model',
  },
  {
    id: 'house-77-msk-001',
    address: 'Москва, ул. Профсоюзная, 100',
    regionCode: '77',
    dataKind: 'model',
  },
];

const categories: Category[] = [
  {
    code: 'heating',
    title: 'Холодные батареи',
    kind: 'utility_quality',
    service: 'heating',
    slaHours: 2,
  },
  {
    code: 'heating_off',
    title: 'Нет отопления',
    kind: 'utility_interruption',
    service: 'heating',
    slaHours: 2,
  },
  {
    code: 'hot_water',
    title: 'Горячая вода холодная',
    kind: 'utility_quality',
    service: 'hot_water',
    slaHours: 2,
  },
  {
    code: 'hot_water_off',
    title: 'Нет горячей воды',
    kind: 'utility_interruption',
    service: 'hot_water',
    slaHours: 2,
  },
  {
    code: 'cold_water_off',
    title: 'Нет холодной воды',
    kind: 'utility_interruption',
    service: 'cold_water',
    slaHours: 2,
  },
  { code: 'yard_lighting', title: 'Освещение', kind: 'repair', zone: 'yard', slaHours: 168 },
  { code: 'yard_cleaning', title: 'Уборка, мусор', kind: 'repair', zone: 'yard', slaHours: 24 },
  { code: 'playground', title: 'Детская площадка', kind: 'repair', zone: 'yard', slaHours: 168 },
  {
    code: 'entrance_light',
    title: 'Не горит свет',
    kind: 'repair',
    zone: 'entrance',
    slaHours: 24,
  },
  {
    code: 'entrance_door',
    title: 'Дверь, домофон',
    kind: 'repair',
    zone: 'entrance',
    slaHours: 72,
  },
  { code: 'elevator', title: 'Лифт', kind: 'repair', zone: 'entrance', slaHours: 24 },
  {
    code: 'entrance_cleaning',
    title: 'Не убран подъезд',
    kind: 'repair',
    zone: 'entrance',
    slaHours: 24,
  },
];

let me: Me = {
  user: {
    id: 'u-mock',
    firstName: 'Тест',
    lastName: 'Житель',
    username: 'test_resident',
    photoUrl: null,
  },
  role: 'resident',
  house: { id: HOUSE_ID, address: HOUSE_ADDRESS },
  apartmentLabel: 'кв. 48',
  consentGiven: true,
  memberships: [
    {
      role: 'resident',
      houseId: HOUSE_ID,
      orgId: null,
      apartmentLabel: 'кв. 48',
      confirmed: false,
    },
  ],
  startParam: null,
};

const iso = (d: Date) => d.toISOString();
const hoursAgo = (h: number) => iso(new Date(Date.now() - h * 3_600_000));
const hoursAhead = (h: number) => iso(new Date(Date.now() + h * 3_600_000));

let demoOffsetMs = 0;
const requests = new Map<string, RequestDetail>();
let seq = 143;

function sample() {
  const id = 'r-2026-0142';
  requests.set(id, {
    id,
    number: '2026-0142',
    title: 'Холодные батареи',
    kind: 'utility_quality',
    service: 'heating',
    status: 'assigned',
    createdAt: hoursAgo(20),
    dueAt: hoursAhead(4),
    overdue: false,
    locationText: 'подъезд 3, этаж 5, кв. 48',
    joinersCount: 13,
    description: 'В угловой комнате +15, батареи чуть тёплые с вечера.',
    location: { scope: 'apartment', entrance: 3, floor: 5 },
    startedAt: hoursAgo(34),
    endedAt: null,
    plannedNotice: null,
    measurements: [{ value: 15, unit: 'celsius', measuredAt: hoursAgo(20), place: 'corner_room' }],
    photos: [],
    events: [
      { type: 'created', label: 'Отправлена', at: hoursAgo(20) },
      { type: 'accepted', label: 'Принята диспетчером', at: hoursAgo(18) },
      { type: 'assigned', label: 'Исполнитель назначен', at: hoursAgo(3) },
    ],
    joiners: Array.from({ length: 13 }, (_, i) => ({
      apartmentLabel: `кв. ${40 + i}`,
      joinedAt: hoursAgo(19 - i),
    })),
    liability: {
      requestId: id,
      apartmentKopecks: 41200,
      houseKopecks: 576800,
      perHourHouseKopecks: 21000,
      hours: 13.5,
      thresholdReachedAt: hoursAgo(34),
      steps: [
        {
          label: 'Норма в угловой комнате',
          value: 20,
          unit: '°C',
          provenance: 'fact',
          ref: { act: 'ПП РФ № 354', point: 'прил. 1, п. 15' },
        },
        { label: 'Ваш замер', value: 15, unit: '°C', provenance: 'fact' },
        { label: 'Отклонение', value: 5, unit: '°C', provenance: 'calc' },
        {
          label: 'Снижение платы за час и градус',
          value: 0.15,
          unit: '%',
          provenance: 'fact',
          ref: { act: 'ПП РФ № 354', point: 'прил. 1, п. 15' },
        },
        { label: 'Плата за отопление в месяц', value: 4120, unit: '₽', provenance: 'model' },
        { label: 'Часов нарушения', value: 13.5, unit: 'ч', provenance: 'calc' },
        { label: 'Квартир в заявке', value: 14, unit: 'шт', provenance: 'fact' },
      ],
      computedAt: iso(new Date()),
      rulesVersion: '2026-09-22',
    },
    executor: { nameShort: 'Иванов И.', slot: 'сегодня, 16:00–19:00', phone: '+7 900 000-11-22' },
    isAuthor: true,
    canJoin: false,
    shareUrl: `https://max.ru/${BOT}?startapp=r_${id}`,
    claim: { available: true, url: null },
    gji: { available: false, afterAt: hoursAhead(4) },
  });
}
sample();

function summary(r: RequestDetail): RequestSummary {
  const { id, number, title, kind, status, createdAt, dueAt, overdue, locationText, joinersCount } =
    r;
  return { id, number, title, kind, status, createdAt, dueAt, overdue, locationText, joinersCount };
}

function locationText(l: NewRequestInput['location']): string {
  const parts: string[] = [];
  if (l.scope === 'yard') parts.push('двор');
  if (l.entrance) parts.push(`подъезд ${l.entrance}`);
  if (l.floor !== undefined) parts.push(`этаж ${l.floor}`);
  if (l.scope === 'apartment' && me.apartmentLabel) parts.push(me.apartmentLabel);
  if (l.note) parts.push(l.note);
  return parts.join(', ');
}

function mockPdf(title: string): string {
  const safe = title.replace(/[()]/g, '');
  const text = `BT /F1 18 Tf 40 780 Td (${safe}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return out;
}

const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const notFound = () =>
  Object.assign(new Error('Заявка не найдена'), { code: 'not_found', status: 404 });

export async function mockApi(path: string, init: RequestInit): Promise<unknown> {
  await delay();
  const url = new URL(path, 'http://mock');
  const p = url.pathname;
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;

  if (p === '/api/me' && method === 'GET') return me;

  if (p === '/api/houses') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return houses.filter((h) => h.address.toLowerCase().includes(q));
  }

  if (p === '/api/me/house' && method === 'POST') {
    const b = body as { houseId: string; apartmentLabel: string };
    const h = houses.find((x) => x.id === b.houseId);
    if (!h) throw notFound();
    me = {
      ...me,
      role: 'resident',
      house: { id: h.id, address: h.address },
      apartmentLabel: b.apartmentLabel,
    };
    return me;
  }

  const homeMatch = p.match(/^\/api\/houses\/([^/]+)\/home$/);
  if (homeMatch) {
    const now = new Date();
    const h = now.getHours();
    const home: Home = {
      house: { id: HOUSE_ID, address: HOUSE_ADDRESS, tz: 'Europe/Moscow', dataKind: 'model' },
      org: {
        id: 'org-1',
        name: 'УК «Уютный дом»',
        address: 'ул. Центральная, 5, офис 2',
        dataKind: 'model',
      },
      contacts: [
        {
          kind: 'dispatcher',
          phone: '+7 843 000-12-34',
          schedule: { days: [1, 2, 3, 4, 5], from: '08:00', to: '20:00' },
          open: { isOpen: h >= 8 && h < 20, until: '20:00' },
        },
        {
          kind: 'office',
          phone: '+7 843 000-56-78',
          schedule: { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' },
          open: { isOpen: h >= 9 && h < 18, until: '18:00' },
        },
        { kind: 'emergency', phone: '+7 843 000-00-01', schedule: null, open: null },
      ],
      announcement: {
        title: 'Объявление УК',
        text: '28.09 с 9:00 до 17:00 — отключение горячей воды, промывка системы.',
      },
      now: iso(now),
    };
    return home;
  }

  if (/^\/api\/houses\/[^/]+\/categories$/.test(p)) return categories;

  if (p === '/api/requests' && method === 'GET') return [...requests.values()].map(summary);

  if (p === '/api/requests' && method === 'POST') {
    const b = body as NewRequestInput;
    const cat = categories.find((c) => c.code === b.category);
    if (!cat)
      throw Object.assign(new Error('Неизвестная категория'), { code: 'bad_request', status: 400 });
    const id = `r-2026-${String(seq++).padStart(4, '0')}`;
    const r: RequestDetail = {
      id,
      number: id.replace('r-', ''),
      title: cat.title,
      kind: cat.kind,
      service: cat.service ?? null,
      status: 'accepted',
      createdAt: iso(new Date()),
      dueAt: hoursAhead(cat.slaHours),
      overdue: false,
      locationText: locationText(b.location),
      joinersCount: 0,
      description: b.description,
      location: b.location,
      startedAt: b.startedAt,
      endedAt: null,
      plannedNotice: b.plannedNotice,
      measurements: b.measurements,
      photos: b.photoKeys.map((key) => ({ key, url: '' })),
      events: [
        { type: 'created', label: 'Отправлена', at: iso(new Date()) },
        { type: 'accepted', label: 'Принята диспетчером', at: iso(new Date()) },
      ],
      joiners: [],
      liability: null,
      executor: null,
      isAuthor: true,
      canJoin: false,
      shareUrl: `https://max.ru/${BOT}?startapp=r_${id}`,
      claim: { available: false, url: null },
      gji: { available: false, afterAt: null },
    };
    requests.set(id, r);
    return r;
  }

  const one = p.match(/^\/api\/requests\/([^/]+)(\/(join|confirm))?$/);
  if (one) {
    const r = requests.get(one[1] ?? '');
    if (!r) throw notFound();
    if (!one[3]) return r;
    if (one[3] === 'join') {
      const b = body as JoinInput;
      r.joiners.push({ apartmentLabel: b.apartmentLabel, joinedAt: iso(new Date()) });
      r.joinersCount = r.joiners.length;
      return r;
    }
    if (one[3] === 'confirm') {
      const b = body as { accepted: boolean };
      r.status = b.accepted ? 'confirmed' : 'reopened';
      r.events.push({
        type: r.status,
        label: b.accepted ? 'Вы подтвердили' : 'Возвращена на доработку',
        at: iso(new Date()),
      });
      return r;
    }
  }

  if (p === '/api/demo/clock') {
    if (method === 'POST') {
      const b = body as { shiftHours?: number; offsetMs?: number; reset?: true };
      if (b.reset) demoOffsetMs = 0;
      else if (typeof b.offsetMs === 'number') demoOffsetMs = b.offsetMs;
      else if (typeof b.shiftHours === 'number')
        demoOffsetMs += Math.round(b.shiftHours * 3_600_000);
    }
    return {
      now: new Date(Date.now() + demoOffsetMs).toISOString(),
      offsetMs: demoOffsetMs,
      label: demoClockLabel(demoOffsetMs),
    };
  }

  if (method === 'POST' && /^\/api\/requests\/[^/]+\/documents\/(claim|gji)\/link$/.test(p)) {
    const [, , , id, , kind] = p.split('/');
    const r = requests.get(id ?? '');
    if (!r) throw notFound();
    if (kind === 'claim' && !r.liability) {
      throw Object.assign(
        new Error('Пока нечего требовать: перерасчёт по этой заявке не насчитан'),
        { code: 'conflict', status: 409 },
      );
    }
    const exp = Date.now() + 30 * 60_000;
    return {
      url: `/api/requests/${id}/documents/${kind}.pdf?exp=${exp}&sig=mock`,
      expiresAt: new Date(exp).toISOString(),
    };
  }

  if (/^\/api\/requests\/[^/]+\/documents\/(claim|gji)\.pdf$/.test(p)) {
    const r = requests.get(p.split('/')[3] ?? '');
    if (!r) throw notFound();
    if (p.endsWith('claim.pdf') && !r.liability) {
      throw Object.assign(
        new Error('Пока нечего требовать: перерасчёт по этой заявке не насчитан'),
        { code: 'conflict', status: 409 },
      );
    }
    return new Blob(
      [mockPdf(p.endsWith('claim.pdf') ? 'Заявление о перерасчёте' : 'Обращение в ГЖИ')],
      { type: 'application/pdf' },
    );
  }

  if (p === '/api/me/data') {
    const data: MyData = {
      userId: me.user.id,
      createdAt: hoursAgo(72),
      items: [
        {
          label: 'Привязка к дому',
          count: 1,
          purpose: 'чтобы показывать контакты вашей УК и считать перерасчёт',
          values: [`${me.house?.address ?? ''}, ${me.apartmentLabel ?? ''}`],
        },
        {
          label: 'Заявки',
          count: requests.size,
          purpose: 'история проблем дома; после удаления остаются без вашего имени',
        },
        {
          label: 'Присоединения к заявкам соседей',
          count: 0,
          purpose: 'чтобы УК видела масштаб проблемы',
        },
        {
          label: 'Согласие на обработку данных',
          count: 1,
          purpose: 'основание хранить всё перечисленное',
        },
      ],
      deletionNotice:
        'Привязка к дому, присоединения и уведомления будут удалены. Ваши заявки останутся у дома, но без связи с вами: соседям они всё ещё нужны.',
    };
    return data;
  }

  if (p === '/api/me' && method === 'DELETE') {
    const result: DeleteMeResult = {
      deleted: { memberships: 1, consents: 1, joins: 0, notifications: 0 },
      anonymizedRequests: requests.size,
    };
    me = { ...me, role: null, house: null, apartmentLabel: null, memberships: [] };
    return result;
  }

  if (p === '/api/photos' && method === 'POST') return { key: `mock/${Date.now()}.jpg`, url: '' };

  throw Object.assign(new Error(`Мок не знает ${method} ${p}`), {
    code: 'mock_missing',
    status: 501,
  });
}
