export * from './contracts';
export * from './deadlines';
export * from './liability';
export * from './quality';
export * from './regions';
export * from './schedule';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
