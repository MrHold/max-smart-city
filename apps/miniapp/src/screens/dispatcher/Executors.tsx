import { useCategories, useExecutors } from '../../api/hooks';
import { Card, Chip, Empty, ErrorView, Loading } from '../../ui';
import { InviteLink } from './InviteLink';

export function Executors({ houseId }: { houseId: string | undefined }) {
  const q = useExecutors();
  const cats = useCategories(houseId);

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorView message={q.error.message} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0)
    return <Empty title="Исполнителей пока нет" text="Они добавляются в данных организации" />;

  const titleOf = (code: string) => cats.data?.find((c) => c.code === code)?.title ?? code;
  const inBot = q.data.filter((e) => e.inBot).length;

  return (
    <div className="stack">
      <div className="muted">
        В боте {inBot} из {q.data.length}. Кто не открыл приглашение, наряды не получает.
      </div>
      <Card pad={false} className="list">
        {q.data.map((e) => (
          <div className="list-item" key={e.id}>
            <div className="grow stack" style={{ gap: 4 }}>
              <div className="row row--between">
                <div className="list-item__title">{e.nameShort}</div>
                <Chip xs tone={e.inBot ? 'ok' : 'warn'}>
                  {e.inBot ? 'в MAX' : 'нет в MAX'}
                </Chip>
              </div>
              <div className="list-item__sub">{e.categories.map(titleOf).join(', ')}</div>
              {!e.inBot && <InviteLink executor={e} />}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
