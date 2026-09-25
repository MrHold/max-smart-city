import { DemoClockInputSchema, type DemoClockState, demoClockLabel } from '@msc/domain';
import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import type { DemoClock } from '../clock/demo';
import { badRequest, notFound } from '../errors';

/**
 * Управление демо-часами. Доступно только при DEMO_MODE=1: в обычном режиме
 * перемотка времени ломала бы расчёты и сроки, поэтому маршрутов просто нет.
 */
export const demoRoutes =
  (
    clock: DemoClock,
    authenticate: preHandlerAsyncHookHandler,
    /** Что сделать сразу после сдвига: например, закрыть заявки, забытые за это время. */
    afterShift?: () => Promise<unknown>,
  ): FastifyPluginAsync =>
  async (app) => {
    const state = (): DemoClockState => ({
      now: clock.now().toISOString(),
      offsetMs: clock.offsetMs(),
      label: demoClockLabel(clock.offsetMs()),
    });

    const guard = () => {
      if (process.env.DEMO_MODE !== '1') throw notFound('Адрес');
    };

    app.get('/api/demo/clock', async () => {
      guard();
      await clock.refresh();
      return state();
    });

    app.post('/api/demo/clock', { preHandler: authenticate }, async (req) => {
      guard();
      const parsed = DemoClockInputSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Укажите сдвиг: shiftHours, offsetMs или reset');

      const input = parsed.data;
      if ('reset' in input) await clock.set(0);
      else if ('offsetMs' in input) await clock.set(input.offsetMs);
      else await clock.shift(Math.round(input.shiftHours * 3_600_000));

      // Перемотка нужна ради демонстрации: без немедленной проверки автозакрытие
      // сработало бы только на следующей минуте, и эффект не был бы виден.
      await afterShift?.();

      return state();
    });
  };
