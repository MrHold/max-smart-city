import { describe, expect, it } from 'vitest';
import { ApartmentLabelSchema } from './common';

describe('ApartmentLabelSchema', () => {
  it.each(['кв. 48', 'кв.48', 'кв. 12а', 'КВ. 1', 'кв. 9999'])('принимает %s', (s) => {
    expect(ApartmentLabelSchema.safeParse(s).success).toBe(true);
  });
  it.each(['кв. 9999999', 'кв. 0', '48', 'квартира 48', 'кв. ', 'кв. -5'])('отклоняет %s', (s) => {
    expect(ApartmentLabelSchema.safeParse(s).success).toBe(false);
  });
});
