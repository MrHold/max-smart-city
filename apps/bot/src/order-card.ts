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
  address?: unknown;
  category?: unknown;
  categoryTitle?: unknown;
  description?: unknown;
  plannedAt?: unknown;
};

/**
 * Карточка наряда: куда, что и когда. Одна и та же в первом наряде и после каждого
 * нажатия кнопок — исполнитель на любом шаге видит адрес и плановое время.
 */
export function orderCard(p: OrderInfo): string {
  const no = p.number ? `№${p.number}` : '';
  const when = formatDate(p.plannedAt);
  const what = categoryTitle(p.categoryTitle ?? p.category);
  return [
    `🛠 Наряд по заявке ${no}`,
    typeof p.address === 'string' && p.address ? `Адрес: ${p.address}` : null,
    what ? `Что: ${what}` : null,
    typeof p.description === 'string' && p.description ? `Описание: ${p.description}` : null,
    when ? `Плановое время: ${when}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
