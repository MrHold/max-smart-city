/** Дата «29 сентября, 10:00» по Москве; null — если даты нет или она кривая. */
export const formatDate = (iso: unknown): string | null => {
  if (typeof iso !== 'string') return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Названия категорий для наряда (коды — из regions/16-tatarstan/categories.yaml).
// Незнакомый код покажем как есть, пока API не начнёт класть название в payload.
const CATEGORY_TITLES: Record<string, string> = {
  heating: 'Холодные батареи',
  heating_off: 'Нет отопления',
  hot_water: 'Горячая вода холодная',
  hot_water_off: 'Нет горячей воды',
  cold_water_off: 'Нет холодной воды',
  yard_lighting: 'Освещение во дворе',
  yard_cleaning: 'Уборка, мусор',
  playground: 'Детская площадка',
  entrance_light: 'Не горит свет в подъезде',
  entrance_door: 'Дверь, домофон',
  elevator: 'Лифт',
  entrance_cleaning: 'Не убран подъезд',
};

export const categoryTitle = (code: unknown): string | null =>
  typeof code === 'string' ? (CATEGORY_TITLES[code] ?? code) : null;

export type OrderInfo = {
  number?: unknown;
  /** Все заявки наряда, если их несколько: одна проблема в доме — один наряд. */
  numbers?: string[];
  address?: unknown;
  /** Сколько квартир затронуто: авторы заявок и присоединившиеся соседи. */
  apartments?: number;
  category?: unknown;
  categoryTitle?: unknown;
  description?: unknown;
  plannedAt?: unknown;
};

const apartmentsWord = (n: number): string => {
  const d = n % 10;
  const dd = n % 100;
  if (d === 1 && dd !== 11) return 'квартира';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'квартиры';
  return 'квартир';
};

function numbersLine(numbers: string[]): string | null {
  if (numbers.length === 0) return null;
  const shown = numbers.slice(0, 3).map((n) => `№${n}`);
  const rest = numbers.length - shown.length;
  const label = numbers.length === 1 ? 'Заявка' : 'Заявки';
  return `${label}: ${shown.join(', ')}${rest > 0 ? ` и ещё ${rest}` : ''}`;
}

/**
 * Карточка наряда: что, куда и когда — коротко, чтобы читалась в уведомлении.
 * Одна и та же в первом наряде и после каждого нажатия кнопок.
 */
export function orderCard(p: OrderInfo): string {
  const when = formatDate(p.plannedAt);
  const what = categoryTitle(p.categoryTitle ?? p.category);
  const address = typeof p.address === 'string' && p.address ? p.address : null;
  const scale =
    p.apartments && p.apartments > 1 ? ` · ${p.apartments} ${apartmentsWord(p.apartments)}` : '';
  const numbers = p.numbers ?? (typeof p.number === 'string' && p.number ? [p.number] : []);
  return [
    `🛠 ${what ?? 'Наряд'}`,
    address ? `📍 ${address}${scale}` : null,
    when ? `🕙 ${when}` : null,
    typeof p.description === 'string' && p.description ? `💬 ${p.description}` : null,
    numbersLine(numbers),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
