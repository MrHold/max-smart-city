import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Тесты API работают с одной базой и чистят таблицы перед каждым тестом,
    // поэтому файлы выполняются по очереди: параллельно они затирали бы данные друг друга.
    fileParallelism: false,
    env: { RATE_LIMIT_MAX: '100000' },
  },
});
