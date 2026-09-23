export * from './contracts';
export * from './schedule';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
