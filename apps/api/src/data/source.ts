import type { Category, Contact, HouseSearchItem, Provenance, Schedule } from '@msc/domain';

export interface HouseRecord extends HouseSearchItem {
  tz: string;
  orgId: string;
}

export interface OrgRecord {
  id: string;
  name: string;
  address: string | null;
  dataKind: Provenance;
  contacts: Array<{ kind: Contact['kind']; phone: string; schedule: Schedule | null }>;
  announcement: { title: string; text: string } | null;
}

/** Справочные данные для маршрутов: дома, организации, категории. Реализация — regions/*.yaml. */
export interface DataSource {
  searchHouses(q: string): Promise<HouseSearchItem[]>;
  getHouse(id: string): Promise<HouseRecord | null>;
  getOrg(id: string): Promise<OrgRecord | null>;
  getCategories(regionCode: string): Promise<Category[]>;
}
