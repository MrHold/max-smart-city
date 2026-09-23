import { describe, expect, it } from 'vitest';
import { scenarios } from '../../fixtures';
import {
  JoinInputSchema,
  LiabilitySchema,
  MeasurementSchema,
  NewRequestInputSchema,
  RequestDetailSchema,
} from './index';

describe('NewRequestInput', () => {
  it('принимает все опорные сценарии', () => {
    for (const s of scenarios) {
      const parsed = NewRequestInputSchema.safeParse(s.input);
      expect(parsed.success, `${s.id}: ${parsed.error?.message}`).toBe(true);
    }
  });

  it('не принимает время со смещением вместо UTC', () => {
    const input = { ...scenarios[0]?.input, startedAt: '2026-11-08T09:00:00+03:00' };
    expect(NewRequestInputSchema.safeParse(input).success).toBe(false);
  });

  it('не принимает больше пяти фотографий', () => {
    const input = {
      ...scenarios[0]?.input,
      photoKeys: ['a', 'b', 'c', 'd', 'e', 'f'],
    };
    expect(NewRequestInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('Measurement', () => {
  it('требует место замера', () => {
    const wrong = { value: 15, unit: 'celsius', measuredAt: '2026-11-08T06:00:00Z' };
    expect(MeasurementSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('Liability', () => {
  const base = {
    requestId: 'r-2026-0142',
    apartmentKopecks: 41_200,
    houseKopecks: 576_800,
    perHourHouseKopecks: 21_000,
    hours: 6,
    thresholdReachedAt: '2026-11-12T09:00:00Z',
    steps: [
      {
        label: 'Часы сверх допустимого перерыва',
        value: 6,
        unit: 'ч',
        provenance: 'calc',
        ref: { act: 'ПП РФ № 354', point: 'приложение 1' },
      },
    ],
    computedAt: '2026-11-12T15:00:00Z',
    rulesVersion: '2026.09.1',
  };

  it('принимает корректный расчёт', () => {
    expect(LiabilitySchema.safeParse(base).success).toBe(true);
  });

  it('не принимает копейки дробью', () => {
    expect(LiabilitySchema.safeParse({ ...base, apartmentKopecks: 412.5 }).success).toBe(false);
  });

  it('допускает непройденный порог', () => {
    const parsed = LiabilitySchema.safeParse({
      ...base,
      apartmentKopecks: 0,
      houseKopecks: 0,
      hours: 0,
      thresholdReachedAt: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe('JoinInput', () => {
  it('принимает присоединение без замеров', () => {
    expect(JoinInputSchema.safeParse({ apartmentLabel: 'кв. 45', measurements: [] }).success).toBe(
      true,
    );
  });

  it('требует непустой номер квартиры', () => {
    expect(JoinInputSchema.safeParse({ apartmentLabel: '', measurements: [] }).success).toBe(false);
  });
});

describe('RequestDetail', () => {
  it('описывает карточку целиком', () => {
    const detail = {
      id: 'r-2026-0142',
      number: '2026-0142',
      title: 'Холодные батареи',
      kind: 'utility_quality',
      status: 'assigned',
      createdAt: '2026-11-08T06:05:00Z',
      dueAt: '2026-11-08T08:05:00Z',
      overdue: false,
      locationText: 'Моя квартира',
      joinersCount: 2,
      service: 'heating',
      description: 'Батареи еле тёплые.',
      location: { scope: 'apartment' },
      startedAt: '2026-11-08T06:00:00Z',
      endedAt: null,
      plannedNotice: null,
      measurements: [
        { value: 15, unit: 'celsius', measuredAt: '2026-11-08T06:00:00Z', place: 'room' },
      ],
      photos: [{ key: 'photo/1.jpg', url: '' }],
      events: [{ type: 'created', label: 'Заявка отправлена', at: '2026-11-08T06:05:00Z' }],
      joiners: [{ apartmentLabel: 'кв. 45', joinedAt: '2026-11-08T07:00:00Z' }],
      liability: null,
      executor: { nameShort: 'Иван П.', slot: '14:00–16:00', phone: null },
      isAuthor: true,
      canJoin: false,
      shareUrl: 'https://max.ru/app?startapp=r_r-2026-0142',
      claim: { available: false, url: null },
      gji: { available: false, afterAt: null },
    };
    const parsed = RequestDetailSchema.safeParse(detail);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});
