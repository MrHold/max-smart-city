import { readFileSync } from 'node:fs';
import type { Db } from '@msc/db';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import type { AuthConfig } from '../auth/config';
import type { DemoClock } from '../clock/demo';
import { loadRegionsData, regionsDataSource } from '../data/regions';
import { buildOpenApi, openApiFile, renderOpenApiYaml, routes } from './spec';

/**
 * Список маршрутов в openapi.yaml ведётся руками, поэтому сверяем его с тем, что на самом
 * деле регистрирует Fastify. База не нужна: маршруты создаются при сборке приложения,
 * к базе они обращаются только при запросе.
 */
async function registeredRoutes(): Promise<string[]> {
  const regions = await loadRegionsData();
  const auth: AuthConfig = {
    botToken: 'test',
    hashSecret: 'test',
    encKey: Buffer.alloc(32),
    maxAgeSec: 3600,
  };
  // Поддельные демо-часы: с ними регистрируются и маршруты демо-режима
  const clock = {
    now: () => new Date(),
    baseNow: () => new Date(),
    offsetMs: () => 0,
    refresh: async () => 0,
    set: async () => 0,
    shift: async () => 0,
    stop: () => {},
  } satisfies DemoClock;

  const app = buildApp({
    data: regionsDataSource(regions),
    regions,
    db: {} as Db,
    auth,
    clock,
  });
  const found = new Set<string>();
  app.addHook('onRoute', (r) => {
    for (const m of [r.method].flat()) {
      if (m === 'HEAD' || m === 'OPTIONS') continue;
      found.add(`${m.toLowerCase()} ${r.url}`);
    }
  });
  await app.ready();
  // /api/health объявлен до того, как успел подключиться обработчик onRoute
  if (app.hasRoute({ method: 'GET', url: '/api/health' })) found.add('get /api/health');
  await app.close();
  return [...found].sort();
}

/** /api/requests/{id} → /api/requests/:id; фото отдаются по маске /api/photos/*. */
const toFastify = (path: string) =>
  path === '/api/photos/{dir}/{file}' ? '/api/photos/*' : path.replace(/\{(\w+)\}/g, ':$1');

describe('openapi.yaml', () => {
  it('описывает ровно те маршруты, что есть в API', async () => {
    const documented = routes.map((r) => `${r.method} ${toFastify(r.path)}`).sort();
    expect(documented).toEqual(await registeredRoutes());
  });

  it('в репозитории лежит свежая версия (иначе: pnpm --filter @msc/api openapi)', () => {
    expect(readFileSync(openApiFile, 'utf8')).toBe(renderOpenApiYaml());
  });

  it('все ссылки $ref ведут на существующие компоненты', () => {
    const doc = buildOpenApi();
    const refs = new Set<string>();
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === '$ref' && typeof v === 'string') refs.add(v);
          else walk(v);
        }
      }
    };
    walk(doc);
    const resolve = (ref: string) =>
      ref
        .slice(2)
        .split('/')
        .reduce<unknown>((acc, key) => (acc as Record<string, unknown> | undefined)?.[key], doc);
    const missing = [...refs].filter((r) => resolve(r) === undefined);
    expect(missing).toEqual([]);
    expect(refs.size).toBeGreaterThan(20);
  });
});
