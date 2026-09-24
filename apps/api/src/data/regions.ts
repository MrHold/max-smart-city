import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Category,
  type FederalRules,
  parseFederalRules,
  parseRegionPackage,
  type RegionPackage,
  resolveCategories,
  toProvenance,
} from '@msc/domain';
import { parse } from 'yaml';
import type { DataSource, HouseRecord, OrgRecord } from './source';

export interface RegionsData {
  rules: FederalRules;
  regions: RegionPackage[];
  categories: Map<string, Category[]>;
}

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const readYaml = async (path: string): Promise<unknown> => parse(await readFile(path, 'utf8'));

/** Читает rules/federal и все regions/<код>; каждый файл проверяется схемами из @msc/domain. */
export async function loadRegionsData(
  root = process.env.DATA_ROOT ?? repoRoot,
): Promise<RegionsData> {
  const rulesDir = join(root, 'rules', 'federal');
  const rules = parseFederalRules({
    quality: await readYaml(join(rulesDir, 'quality-354.yaml')),
    interruption: await readYaml(join(rulesDir, 'interruption-354.yaml')),
    deadlines: await readYaml(join(rulesDir, 'deadlines-416.yaml')),
  });

  const regionsDir = join(root, 'regions');
  const regions: RegionPackage[] = [];
  for (const name of (await readdir(regionsDir)).sort()) {
    const dir = join(regionsDir, name);
    if (!(await stat(dir)).isDirectory()) continue;
    const file = (f: string) => readYaml(join(dir, f));
    regions.push(
      parseRegionPackage({
        meta: await file('meta.yaml'),
        categories: await file('categories.yaml'),
        tariffs: await file('tariffs.yaml'),
        normatives: await file('normatives.yaml'),
        orgs: await file('orgs.yaml'),
        houses: await file('houses.yaml'),
      }),
    );
  }

  const categories = new Map(regions.map((r) => [r.meta.code, resolveCategories(r, rules)]));
  return { rules, regions, categories };
}

export function regionsDataSource(data: RegionsData): DataSource {
  const houses: HouseRecord[] = data.regions.flatMap((r) =>
    r.houses.map((h) => ({
      id: h.id,
      address: h.address,
      regionCode: r.meta.code,
      tz: r.meta.timezone,
      orgId: h.orgId,
      dataKind: toProvenance(h.dataKind),
    })),
  );
  const orgs = new Map<string, OrgRecord>();
  for (const r of data.regions) {
    for (const o of r.orgs) {
      orgs.set(o.id, {
        id: o.id,
        name: o.name,
        address: o.address,
        dataKind: toProvenance(o.dataKind),
        contacts: o.contacts,
        announcement: o.announcement,
      });
    }
  }

  return {
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
      return orgs.get(id) ?? null;
    },
    async getCategories(regionCode) {
      return data.categories.get(regionCode) ?? [];
    },
  };
}
