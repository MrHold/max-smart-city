import type { Liability, Measurement } from '@msc/domain';
import { date, dateTime, disclaimer, money, renderPdf, styles } from './pdf';

export interface ClaimData {
  /** Кому адресовано: управляющая организация или ресурсоснабжающая. */
  org: { name: string; address: string | null };
  house: { address: string; tz: string };
  applicant: { apartmentLabel: string };
  request: {
    number: string;
    title: string;
    description: string;
    startedAt: string;
    endedAt: string | null;
    createdAt: string;
  };
  /** Вердикт по норме: что должно быть и что оказалось. */
  verdict: { normText: string; actualText: string; ref: string } | null;
  measurements: Measurement[];
  liability: Liability;
  /** Квартиры соседей, подтвердивших ту же проблему. */
  joiners: string[];
  asOf: string;
}

const placeName: Record<Measurement['place'], string> = {
  room: 'комната',
  corner_room: 'угловая комната',
  tap: 'точка разбора',
};

/**
 * Заявление о перерасчёте платы.
 *
 * Документ намеренно устроен так, чтобы его можно было проверить: каждая цифра
 * в расчёте показана отдельной строкой со ссылкой на норму, а не выведена итогом.
 */
export async function buildClaimPdf(data: ClaimData): Promise<Buffer> {
  const tz = data.house.tz;
  const period = data.request.endedAt
    ? `с ${dateTime(data.request.startedAt, tz)} по ${dateTime(data.request.endedAt, tz)}`
    : `с ${dateTime(data.request.startedAt, tz)} по настоящее время`;

  const calcRows = data.liability.steps.map((s) => [
    { text: s.label, fontSize: 10 },
    { text: `${s.value} ${s.unit}`.trim(), fontSize: 10, alignment: 'right' as const },
    { text: s.ref ? `${s.ref.act}, ${s.ref.point}` : '', style: 'small' },
  ]);

  return renderPdf({
    pageSize: 'A4',
    pageMargins: [56, 48, 56, 48],
    defaultStyle: { font: 'Roboto', fontSize: 11 },
    styles,
    content: [
      { text: data.org.name, style: 'address' },
      ...(data.org.address ? [{ text: data.org.address, style: 'address' }] : []),
      {
        text: `от собственника (нанимателя) помещения ${data.applicant.apartmentLabel}`,
        style: 'address',
      },
      { text: data.house.address, style: 'address', margin: [0, 0, 0, 24] },

      { text: 'Заявление о перерасчёте платы за коммунальную услугу', style: 'header' },

      {
        text: `По заявке № ${data.request.number} от ${date(data.request.createdAt, tz)}.`,
        style: 'body',
      },
      {
        text:
          `${period} в помещении по адресу ${data.house.address}, ${data.applicant.apartmentLabel}, ` +
          `коммунальная услуга предоставлялась с нарушением: ${data.request.title.toLowerCase()}. ` +
          `${data.request.description}`,
        style: 'body',
      },
      ...(data.verdict
        ? [
            {
              text: `Норматив: ${data.verdict.normText}. Зафиксировано: ${data.verdict.actualText}. Основание: ${data.verdict.ref}.`,
              style: 'body',
            },
          ]
        : []),

      ...(data.measurements.length
        ? [
            { text: 'Замеры', style: 'header', fontSize: 12 },
            {
              table: {
                widths: ['auto', 'auto', '*'],
                body: [
                  [
                    { text: 'Дата и время', style: 'tableHeader' },
                    { text: 'Значение', style: 'tableHeader' },
                    { text: 'Место', style: 'tableHeader' },
                  ],
                  ...data.measurements.map((m) => [
                    { text: dateTime(m.measuredAt, tz), fontSize: 10 },
                    { text: `${m.value} °C`, fontSize: 10 },
                    { text: placeName[m.place], fontSize: 10 },
                  ]),
                ],
              },
              layout: 'lightHorizontalLines',
              margin: [0, 0, 0, 12],
            },
          ]
        : []),

      { text: 'Расчёт снижения платы', style: 'header', fontSize: 12 },
      {
        table: {
          widths: ['*', 'auto', 'auto'],
          body: [
            [
              { text: 'Показатель', style: 'tableHeader' },
              { text: 'Значение', style: 'tableHeader', alignment: 'right' },
              { text: 'Основание', style: 'tableHeader' },
            ],
            ...calcRows,
            [
              { text: 'Итого к перерасчёту', bold: true, fontSize: 11 },
              {
                text: money(data.liability.apartmentKopecks),
                bold: true,
                fontSize: 11,
                alignment: 'right' as const,
              },
              { text: '' },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 12],
      },

      ...(data.joiners.length
        ? [
            {
              text: `Ту же проблему подтвердили жители помещений: ${data.joiners.join(', ')}.`,
              style: 'body',
            },
          ]
        : []),

      { text: 'На основании изложенного прошу:', style: 'body', margin: [0, 6, 0, 4] },
      {
        ol: [
          `произвести перерасчёт платы за период ${period} на сумму ${money(data.liability.apartmentKopecks)};`,
          'устранить нарушение и сообщить о принятых мерах;',
          'направить письменный ответ в установленный срок.',
        ],
        style: 'body',
      },

      {
        text: '___________________ / ___________________',
        margin: [0, 24, 0, 0],
        fontSize: 11,
      },
      { text: 'подпись, расшифровка, дата', style: 'small' },

      disclaimer(data.asOf, tz),
    ],
  });
}
