import { systemClock } from '@msc/domain';

console.log('api ok', systemClock.now().toISOString());
