import { useCategories, useExecutors } from '../../api/hooks';
import { Card, Chip, cx, Empty, ErrorView, Loading, Stat } from '../../ui';
import { IconUser } from '../../ui/icons';
import { InviteLink } from './InviteLink';

export function Executors({ houseId }: { houseId: string | undefined }) {
  const q = useExecutors();
  const cats = useCategories(houseId);

  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorView error={q.error} message={q.error.message} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0)
    return <Empty title="Исполнителей пока нет" text="Они добавляются в данных организации" />;

  const titleOf = (code: string) => cats.data?.find((c) => c.code === code)?.title ?? code;
  const inBot = q.data.filter((e) => e.inBot).length;
  const waiting = q.data.length - inBot;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stats">
        <Stat small value={`${inBot} из ${q.data.length}`} label="получают наряды в MAX" />
        <Stat
          small
          value={String(waiting)}
          label="не открыли приглашение, наряды до них не дойдут"
          tone={waiting > 0 ? 'warn' : undefined}
        />
      </div>
      {/* Карточками: на телефоне столбиком, на компьютере в несколько колонок */}
      <div className="exec-grid">
        {q.data.map((e) => (
          <Card key={e.id} className="card__section exec-card">
            <div className="row" style={{ gap: 12 }}>
              <span
                className={cx('icon-sq', e.inBot ? 'icon-sq--ok' : 'icon-sq--warn')}
                aria-hidden="true"
              >
                <IconUser size={20} />
              </span>
              <div className="grow stack">
                <div className="list-item__title">{e.nameShort}</div>
                <div
                  className={cx('status-line', e.inBot ? 'status-line--ok' : 'status-line--warn')}
                >
                  <span className="dot" />
                  {e.inBot ? 'Получает наряды в MAX' : 'Ещё не в боте'}
                </div>
              </div>
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {e.categories.map((code) => (
                <Chip xs key={code}>
                  {titleOf(code)}
                </Chip>
              ))}
            </div>
            {!e.inBot && (
              <div className="exec-card__action">
                <InviteLink executor={e} buttons />
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
