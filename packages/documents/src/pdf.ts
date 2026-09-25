import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * pdfmake 0.3 работает как одиночка: шрифты кладутся в его виртуальную файловую
 * систему и регистрируются один раз на процесс. Roboto берём из самого пакета —
 * в нём есть кириллица, отдельные файлы шрифтов в репозитории не нужны.
 */
let ready: unknown;

function printer() {
  if (ready) return ready as { createPdf: (def: unknown) => { getBuffer(): Promise<Buffer> } };

  const pdfmake = require('pdfmake');
  const fonts = require('pdfmake/build/vfs_fonts.js');
  const table: Record<string, string> = fonts.pdfMake?.vfs ?? fonts.vfs ?? fonts;

  // Шрифты лежат в base64; без явного декодирования pdfkit получает строку
  // и падает с «Unknown font format».
  for (const [name, content] of Object.entries(table)) {
    pdfmake.virtualfs.writeFileSync(name, Buffer.from(content, 'base64'));
  }

  pdfmake.setFonts({
    Roboto: {
      normal: 'Roboto-Regular.ttf',
      bold: 'Roboto-Medium.ttf',
      italics: 'Roboto-Italic.ttf',
      bolditalics: 'Roboto-MediumItalic.ttf',
    },
  });

  // Документ собирается только из наших данных: ни сеть, ни файлы читать не нужно.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy(() => false);

  ready = pdfmake;
  return pdfmake;
}

export async function renderPdf(docDefinition: Record<string, unknown>): Promise<Buffer> {
  return printer().createPdf(docDefinition).getBuffer();
}

export const styles = {
  header: { fontSize: 14, bold: true, margin: [0, 0, 0, 8] as [number, number, number, number] },
  address: {
    fontSize: 10,
    alignment: 'right' as const,
    margin: [0, 0, 0, 2] as [number, number, number, number],
  },
  body: {
    fontSize: 11,
    lineHeight: 1.25,
    margin: [0, 0, 0, 6] as [number, number, number, number],
  },
  small: { fontSize: 9, color: '#555555' },
  tableHeader: { fontSize: 10, bold: true },
};

export const money = (kopecks: number): string =>
  `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

export const date = (iso: string, tz = 'Europe/Moscow'): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));

export const dateTime = (iso: string, tz = 'Europe/Moscow'): string =>
  new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

/** Приписка, без которой документ выглядел бы официальным заключением, каковым он не является. */
export const disclaimer = (asOf: string, tz?: string) => ({
  text:
    `Документ подготовлен автоматически ${dateTime(asOf, tz)} по данным, указанным заявителем, ` +
    'и открытым данным. Расчёт выполнен по Правилам предоставления коммунальных услуг. ' +
    'Документ не является юридической консультацией. Перед подачей проверьте реквизиты адресата ' +
    'и приложите подтверждающие материалы.',
  style: 'small',
  margin: [0, 18, 0, 0] as [number, number, number, number],
});
