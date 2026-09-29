const dt = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' });
const dtTime = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const timeOnly = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

export const fmtDate = (iso: string) => dt.format(new Date(iso));
export const fmtDateTime = (iso: string) => dtTime.format(new Date(iso)).replace(',', ',');
export const fmtTime = (iso: string) => timeOnly.format(new Date(iso));

export function fmtDuration(ms: number): string {
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  if (h >= 48) {
    const d = Math.floor(h / 24);
    return `${d} ${plural(d, 'день', 'дня', 'дней')}`;
  }
  if (h > 0) return m ? `${h} ч ${m} мин` : `${h} ч`;
  return `${m} мин`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Температура из поля ввода: на русской клавиатуре десятичный разделитель — запятая. */
export function parseTemp(s: string): number | null {
  const t = Number(s.trim().replace(',', '.'));
  return s.trim() === '' || Number.isNaN(t) ? null : t;
}

export function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
