import { describe, expect, it } from 'vitest';
import { allowedScopes } from './location';

describe('где может быть проблема', () => {
  it('двор — только во дворе', () => {
    expect(allowedScopes({ kind: 'repair', zone: 'yard' })).toEqual(['yard']);
  });

  it('подъезд — в подъезде или на этаже, но не в квартире', () => {
    expect(allowedScopes({ kind: 'repair', zone: 'entrance' })).toEqual(['entrance', 'floor']);
  });

  it('отопление и вода — в квартире', () => {
    expect(allowedScopes({ kind: 'utility_quality' })).toEqual(['apartment']);
    expect(allowedScopes({ kind: 'utility_interruption' })).toEqual(['apartment']);
  });

  it('без зоны — любое место', () => {
    expect(allowedScopes({ kind: 'repair' })).toHaveLength(4);
  });
});
