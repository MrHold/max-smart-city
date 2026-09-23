import type { Category, Contact, HouseSearchItem, Schedule } from '@msc/domain';

/**
 * Демо-данные на время, пока нет БД и regions/. Модельные: помечены dataKind 'model'.
 * Интерфейс DataSource остаётся, реализация меняется на БД без правки маршрутов.
 */
export interface HouseRecord extends HouseSearchItem {
  tz: string;
  orgId: string;
}

export interface OrgRecord {
  id: string;
  name: string;
  address: string | null;
  dataKind: 'fact' | 'model';
  contacts: Array<{ kind: Contact['kind']; phone: string; schedule: Schedule | null }>;
  announcement: { title: string; text: string } | null;
}

export interface DataSource {
  searchHouses(q: string): Promise<HouseSearchItem[]>;
  getHouse(id: string): Promise<HouseRecord | null>;
  getOrg(id: string): Promise<OrgRecord | null>;
  getCategories(regionCode: string): Promise<Category[]>;
}

const weekdays = [1, 2, 3, 4, 5];

const orgs: OrgRecord[] = [
  {
    id: 'org-16-uyut',
    name: 'УК «Уютный дом»',
    address: 'Казань, ул. Центральная, 5, офис 2',
    dataKind: 'model',
    contacts: [
      {
        kind: 'dispatcher',
        phone: '+7 843 000-12-34',
        schedule: { days: weekdays, from: '08:00', to: '20:00' },
      },
      {
        kind: 'office',
        phone: '+7 843 000-56-78',
        schedule: { days: weekdays, from: '09:00', to: '18:00' },
      },
      { kind: 'emergency', phone: '+7 843 000-00-01', schedule: null },
    ],
    announcement: {
      title: 'Объявление УК',
      text: '28.09 с 9:00 до 17:00 — отключение горячей воды, промывка системы.',
    },
  },
  {
    id: 'org-77-demo',
    name: 'УК «Профсоюзная»',
    address: 'Москва, ул. Профсоюзная, 98',
    dataKind: 'model',
    contacts: [
      {
        kind: 'dispatcher',
        phone: '+7 495 000-11-22',
        schedule: { days: [1, 2, 3, 4, 5, 6, 7], from: '00:00', to: '23:59' },
      },
      {
        kind: 'office',
        phone: '+7 495 000-33-44',
        schedule: { days: weekdays, from: '10:00', to: '19:00' },
      },
      { kind: 'emergency', phone: '+7 495 000-00-02', schedule: null },
    ],
    announcement: null,
  },
];

const houses: HouseRecord[] = [
  {
    id: 'house-16-kazan-001',
    address: 'Казань, ул. Садовая, 12',
    regionCode: '16',
    tz: 'Europe/Moscow',
    orgId: 'org-16-uyut',
    dataKind: 'model',
  },
  {
    id: 'house-16-kazan-002',
    address: 'Казань, ул. Центральная, 5',
    regionCode: '16',
    tz: 'Europe/Moscow',
    orgId: 'org-16-uyut',
    dataKind: 'model',
  },
  {
    id: 'house-16-kazan-003',
    address: 'Казань, пр. Победы, 40',
    regionCode: '16',
    tz: 'Europe/Moscow',
    orgId: 'org-16-uyut',
    dataKind: 'model',
  },
  {
    id: 'house-77-msk-001',
    address: 'Москва, ул. Профсоюзная, 100',
    regionCode: '77',
    tz: 'Europe/Moscow',
    orgId: 'org-77-demo',
    dataKind: 'model',
  },
];

const utility: Category[] = [
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
];

const repairs: Category[] = [
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

export const demoData: DataSource = {
  async searchHouses(q) {
    const needle = q.trim().toLowerCase();
    return houses
      .filter((h) => h.address.toLowerCase().includes(needle))
      .map(({ id, address, regionCode, dataKind }) => ({ id, address, regionCode, dataKind }));
  },
  async getHouse(id) {
    return houses.find((h) => h.id === id) ?? null;
  },
  async getOrg(id) {
    return orgs.find((o) => o.id === id) ?? null;
  },
  async getCategories() {
    return [...utility, ...repairs];
  },
};
