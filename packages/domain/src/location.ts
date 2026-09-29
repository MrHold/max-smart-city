import type { LocationScope, RequestKind } from './contracts/common';

const ALL: LocationScope[] = ['apartment', 'entrance', 'floor', 'yard'];

/**
 * Где может быть проблема этой категории. Порядок важен: первое место — выбор по умолчанию.
 * Уборка двора не бывает «в квартире», а горячая вода — «во дворе»: такие заявки
 * путают диспетчера и исполнителя, поэтому их не принимает ни форма, ни API.
 */
export function allowedScopes(category: {
  code?: string;
  kind: RequestKind;
  zone?: 'yard' | 'entrance' | 'apartment';
}): LocationScope[] {
  // Лифт застревает между конкретными этажами: подъезд без этажа исполнителю ничего не говорит
  if (category.code === 'elevator') return ['floor'];
  if (category.zone === 'yard') return ['yard'];
  if (category.zone === 'entrance') return ['entrance', 'floor'];
  if (category.zone === 'apartment') return ['apartment'];
  // Отопление и вода: перерасчёт и нормативы считаются по квартире жителя
  if (category.kind === 'utility_quality' || category.kind === 'utility_interruption')
    return ['apartment'];
  return ALL;
}
