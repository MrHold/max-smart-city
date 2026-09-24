export * from './cluster';
export * from './contracts';
export * from './deadlines';
export * from './liability';
export * from './quality';
export * from './regions';
export * from './schedule';
export * from './workflow';

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
