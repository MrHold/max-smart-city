import { date, dateTime, disclaimer, renderPdf, styles } from './pdf';

export interface GjiComplaintData {
  /** Орган государственного жилищного надзора региона. */
  gji: { name: string; address: string | null };
  org: { name: string };
  house: { address: string; tz: string };
  applicant: { apartmentLabel: string };
  request: {
    number: string;
    title: string;
    description: string;
    createdAt: string;
    startedAt: string;
    dueAt: string;
  };
  /** Сколько квартир подтвердили ту же проблему, включая заявителя. */
  apartments: number;
  asOf: string;
}

/**
 * Жалоба в жилищную инспекцию.
 *
 * Ключевая часть — хронология: когда обратились в управляющую организацию, какой срок
 * был у неё по норме и что он истёк. Без этого жалобу возвращают как преждевременную,
 * поэтому продукт и открывает этот шаг только после истечения срока.
 */
export async function buildGjiPdf(data: GjiComplaintData): Promise<Buffer> {
  const tz = data.house.tz;

  return renderPdf({
    pageSize: 'A4',
    pageMargins: [56, 48, 56, 48],
    defaultStyle: { font: 'Roboto', fontSize: 11 },
    styles,
    content: [
      { text: data.gji.name, style: 'address' },
      ...(data.gji.address ? [{ text: data.gji.address, style: 'address' }] : []),
      {
        text: `от собственника (нанимателя) помещения ${data.applicant.apartmentLabel}`,
        style: 'address',
      },
      { text: data.house.address, style: 'address', margin: [0, 0, 0, 24] },

      { text: 'Обращение о нарушении при содержании многоквартирного дома', style: 'header' },

      {
        text:
          `Управляющая организация ${data.org.name} не устранила нарушение по заявке ` +
          `№ ${data.request.number} в установленный срок.`,
        style: 'body',
      },

      { text: 'Хронология', style: 'header', fontSize: 12 },
      {
        table: {
          widths: ['auto', '*'],
          body: [
            [
              { text: dateTime(data.request.startedAt, tz), fontSize: 10 },
              { text: `Началось нарушение: ${data.request.title.toLowerCase()}`, fontSize: 10 },
            ],
            [
              { text: dateTime(data.request.createdAt, tz), fontSize: 10 },
              {
                text: `Заявка № ${data.request.number} направлена в ${data.org.name}`,
                fontSize: 10,
              },
            ],
            [
              { text: dateTime(data.request.dueAt, tz), fontSize: 10 },
              { text: 'Истёк срок, установленный нормативом', fontSize: 10 },
            ],
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 12],
      },

      { text: `Суть обращения: ${data.request.description}`, style: 'body' },
      ...(data.apartments > 1
        ? [
            {
              text: `Проблема затрагивает ${data.apartments} помещений в доме — жители подтвердили её самостоятельно.`,
              style: 'body',
            },
          ]
        : []),

      { text: 'Прошу:', style: 'body', margin: [0, 6, 0, 4] },
      {
        ol: [
          'провести проверку по изложенным фактам;',
          'обязать управляющую организацию устранить нарушение;',
          'сообщить о результатах рассмотрения обращения.',
        ],
        style: 'body',
      },

      {
        text: `Дата обращения: ${date(data.asOf, tz)}`,
        style: 'body',
        margin: [0, 12, 0, 0],
      },
      { text: '___________________ / ___________________', margin: [0, 18, 0, 0], fontSize: 11 },
      { text: 'подпись, расшифровка', style: 'small' },

      disclaimer(data.asOf, tz),
    ],
  });
}
