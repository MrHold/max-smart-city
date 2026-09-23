import type { Measurement, NewRequestInput, RequestKind, Service } from '../src/contracts';

/**
 * Опорные случаи, по которым пишутся и проверяются checkQuality() и calcLiability().
 * Два из них обязаны давать «нарушения нет» — они проверяют, что продукт не обещает
 * жителю деньги там, где их не положено.
 *
 * Время везде UTC, часовой пояс дома — Europe/Moscow (UTC+3),
 * поэтому 22:00Z это 01:00 по местному, то есть ночь.
 */
export interface Scenario {
  id: string;
  title: string;
  category: string;
  kind: RequestKind;
  service: Service | null;
  /** Часовой пояс дома: от него зависит, ночное послабление применяется или нет. */
  tz: string;
  input: NewRequestInput;
  expected: {
    /** null — категория без норматива качества, вердикт не выносится. */
    violated: boolean | null;
    /** Есть ли снижение платы. Нарушение без превышения порога денег не даёт. */
    hasLiability: boolean;
    why: string;
  };
}

const m = (
  value: number,
  measuredAt: string,
  place: Measurement['place'] = 'room',
): Measurement => ({
  value,
  unit: 'celsius',
  measuredAt,
  place,
});

export const scenarios: Scenario[] = [
  {
    id: 'heating-below-norm',
    title: 'Батареи холодные днём, +15 при норме +18',
    category: 'heating',
    kind: 'utility_quality',
    service: 'heating',
    tz: 'Europe/Moscow',
    input: {
      category: 'heating',
      location: { scope: 'apartment' },
      description: 'Батареи еле тёплые второй день, дома +15.',
      startedAt: '2026-11-08T06:00:00Z',
      measurements: [m(15, '2026-11-08T06:00:00Z'), m(15.5, '2026-11-08T15:00:00Z')],
      plannedNotice: null,
      photoKeys: ['photo/thermometer-1.jpg'],
    },
    expected: {
      violated: true,
      hasLiability: true,
      why: 'Днём снижение температуры не допускается: 3 °C отклонения за каждый час.',
    },
  },
  {
    id: 'heating-night-within-tolerance',
    title: 'Ночью +16 при норме +18 — в пределах допуска',
    category: 'heating',
    kind: 'utility_quality',
    service: 'heating',
    tz: 'Europe/Moscow',
    input: {
      category: 'heating',
      location: { scope: 'apartment' },
      description: 'Ночью прохладно.',
      startedAt: '2026-11-08T22:10:00Z',
      measurements: [m(16, '2026-11-08T22:10:00Z')],
      plannedNotice: null,
      photoKeys: [],
    },
    expected: {
      violated: false,
      hasLiability: false,
      why: 'С 00:00 до 05:00 по местному времени допустимо снижение до 3 °C.',
    },
  },
  {
    id: 'heating-corner-room',
    title: 'Угловая комната +19 — норма для неё +20',
    category: 'heating',
    kind: 'utility_quality',
    service: 'heating',
    tz: 'Europe/Moscow',
    input: {
      category: 'heating',
      location: { scope: 'apartment' },
      description: 'В угловой комнате холоднее остальных.',
      startedAt: '2026-11-09T09:00:00Z',
      measurements: [m(19, '2026-11-09T09:00:00Z', 'corner_room')],
      plannedNotice: null,
      photoKeys: [],
    },
    expected: {
      violated: true,
      hasLiability: true,
      why: 'Для угловой комнаты норма выше обычной, +19 её не достигает.',
    },
  },
  {
    id: 'hot-water-below-60',
    title: 'Горячая вода +48 днём',
    category: 'hot_water',
    kind: 'utility_quality',
    service: 'hot_water',
    tz: 'Europe/Moscow',
    input: {
      category: 'hot_water',
      location: { scope: 'apartment' },
      description: 'Из крана еле тёплая вода.',
      startedAt: '2026-11-10T07:00:00Z',
      measurements: [m(48, '2026-11-10T07:00:00Z', 'tap')],
      plannedNotice: null,
      photoKeys: [],
    },
    expected: {
      violated: true,
      hasLiability: true,
      why: 'Днём допустимо отклонение до 3 °C, отклонение считается шагами по 3 °C.',
    },
  },
  {
    id: 'cold-water-interruption-short',
    title: 'Холодной воды нет 3 часа',
    category: 'cold_water_off',
    kind: 'utility_interruption',
    service: 'cold_water',
    tz: 'Europe/Moscow',
    input: {
      category: 'cold_water_off',
      location: { scope: 'apartment' },
      description: 'С утра нет холодной воды.',
      startedAt: '2026-11-11T05:00:00Z',
      measurements: [],
      plannedNotice: false,
      photoKeys: [],
    },
    expected: {
      violated: false,
      hasLiability: false,
      why: 'Единовременный перерыв до 4 часов укладывается в допустимый.',
    },
  },
  {
    id: 'cold-water-interruption-long',
    title: 'Холодной воды нет 9 часов',
    category: 'cold_water_off',
    kind: 'utility_interruption',
    service: 'cold_water',
    tz: 'Europe/Moscow',
    input: {
      category: 'cold_water_off',
      location: { scope: 'apartment' },
      description: 'Воды нет с утра, аварию не устранили.',
      startedAt: '2026-11-12T05:00:00Z',
      measurements: [],
      plannedNotice: false,
      photoKeys: [],
    },
    expected: {
      violated: true,
      hasLiability: true,
      why: 'Сверх порога считается каждый час, но только часы после его превышения.',
    },
  },
  {
    id: 'hot-water-planned-shutdown',
    title: 'Плановое летнее отключение горячей воды',
    category: 'hot_water_off',
    kind: 'utility_interruption',
    service: 'hot_water',
    tz: 'Europe/Moscow',
    input: {
      category: 'hot_water_off',
      location: { scope: 'apartment' },
      description: 'Горячей воды нет, висело объявление о промывке.',
      startedAt: '2026-06-15T04:00:00Z',
      measurements: [],
      plannedNotice: true,
      photoKeys: [],
    },
    expected: {
      violated: false,
      hasLiability: false,
      why: 'Плановое отключение в пределах установленного срока нарушением не является.',
    },
  },
  {
    id: 'entrance-light-repair',
    title: 'Не горит свет в подъезде',
    category: 'entrance_light',
    kind: 'repair',
    service: null,
    tz: 'Europe/Moscow',
    input: {
      category: 'entrance_light',
      location: { scope: 'entrance', entrance: 3, floor: 5 },
      description: 'Третий подъезд, пятый этаж — темно.',
      startedAt: '2026-11-13T18:00:00Z',
      measurements: [],
      plannedNotice: null,
      photoKeys: ['photo/entrance-1.jpg'],
    },
    expected: {
      violated: null,
      hasLiability: false,
      why: 'У ремонтных заявок есть срок устранения, но нет норматива качества и перерасчёта.',
    },
  },
];

export const scenarioById = (id: string): Scenario => {
  const found = scenarios.find((s) => s.id === id);
  if (!found) throw new Error(`Нет сценария ${id}`);
  return found;
};
