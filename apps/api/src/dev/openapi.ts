// Пересобирает openapi.yaml в корне репозитория:
//   pnpm --filter @msc/api openapi
// Запускать после любого изменения контрактов в packages/domain или маршрутов API —
// иначе тест openapi/spec.test.ts упадёт и напомнит.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openApiFile, renderOpenApiYaml, routes } from '../openapi/spec';

writeFileSync(openApiFile, renderOpenApiYaml());
console.log(`${fileURLToPath(openApiFile)}: ${routes.length} маршрутов`);
