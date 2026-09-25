import { describe, expect, it } from 'vitest';
import { buildClaimPdf, type ClaimData } from './claim';
import { buildGjiPdf, type GjiComplaintData } from './gji';

const claim: ClaimData = {
  org: { name: 'УК «Уютный дом»', address: 'Казань, ул. Центральная, 5, офис 2' },
  house: { address: 'Казань, ул. Садовая, 12', tz: 'Europe/Moscow' },
  applicant: { apartmentLabel: 'кв. 12' },
  request: {
    number: '2026-0142',
    title: 'Холодные батареи',
    description: 'Батареи еле тёплые второй день.',
    startedAt: '2026-11-10T03:30:00.000Z',
    endedAt: null,
    createdAt: '2026-11-10T04:00:00.000Z',
  },
  verdict: {
    normText: 'не ниже +18 °C',
    actualText: '+15 °C',
    ref: 'ПП РФ № 354, приложение 1, раздел VI',
  },
  measurements: [
    { value: 15, unit: 'celsius', measuredAt: '2026-11-10T03:30:00.000Z', place: 'room' },
  ],
  liability: {
    requestId: 'r-1',
    apartmentKopecks: 6496,
    houseKopecks: 12992,
    perHourHouseKopecks: 2164,
    hours: 6,
    thresholdReachedAt: '2026-11-10T03:30:00.000Z',
    steps: [
      { label: 'Плата за услугу за месяц', value: 2406.08, unit: '₽', provenance: 'calc' },
      {
        label: 'Отклонение от допустимого',
        value: 3,
        unit: '°C',
        provenance: 'fact',
        ref: { act: 'ПП РФ № 354', point: 'приложение 1, раздел VI' },
      },
      { label: 'Часы с отклонением', value: 6, unit: 'ч', provenance: 'calc' },
    ],
    computedAt: '2026-11-10T09:30:00.000Z',
    rulesVersion: '2026.09.1',
  },
  joiners: ['кв. 45', 'кв. 48'],
  asOf: '2026-11-10T09:30:00.000Z',
};

const gji: GjiComplaintData = {
  gji: { name: 'Государственная жилищная инспекция Республики Татарстан', address: 'Казань' },
  org: { name: 'УК «Уютный дом»' },
  house: { address: 'Казань, ул. Садовая, 12', tz: 'Europe/Moscow' },
  applicant: { apartmentLabel: 'кв. 12' },
  request: {
    number: '2026-0142',
    title: 'Холодные батареи',
    description: 'Батареи еле тёплые второй день.',
    createdAt: '2026-11-10T04:00:00.000Z',
    startedAt: '2026-11-10T03:30:00.000Z',
    dueAt: '2026-11-10T05:30:00.000Z',
  },
  apartments: 3,
  asOf: '2026-11-12T09:30:00.000Z',
};

const isPdf = (buf: Buffer) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

describe('заявление о перерасчёте', () => {
  it('собирается в настоящий PDF', async () => {
    const pdf = await buildClaimPdf(claim);
    expect(isPdf(pdf)).toBe(true);
    // Несколько килобайт — признак того, что документ не пустой.
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it('документ без соседей и без замеров тоже собирается', async () => {
    const pdf = await buildClaimPdf({ ...claim, joiners: [], measurements: [] });
    expect(isPdf(pdf)).toBe(true);
  });

  it('устранённое нарушение даёт документ с закрытым периодом', async () => {
    const pdf = await buildClaimPdf({
      ...claim,
      request: { ...claim.request, endedAt: '2026-11-10T09:00:00.000Z' },
    });
    expect(isPdf(pdf)).toBe(true);
  });
});

describe('жалоба в ГЖИ', () => {
  it('собирается в настоящий PDF', async () => {
    const pdf = await buildGjiPdf(gji);
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it('работает и для одной квартиры', async () => {
    const pdf = await buildGjiPdf({ ...gji, apartments: 1 });
    expect(isPdf(pdf)).toBe(true);
  });
});
