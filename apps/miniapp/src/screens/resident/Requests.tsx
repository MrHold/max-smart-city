import { useState } from 'react';
import { useMyRequests } from '../../api/hooks';
import { fmtDate } from '../../lib/format';
import { closedStatuses, statusLabel, statusTone } from '../../lib/request';
import { ButtonLink, Card, Chip, Empty, ErrorView, Loading, Segmented } from '../../ui';
import { IconPlus } from '../../ui/icons';

export function Requests() {
  const q = useMyRequests();
  const [tab, setTab] = useState<'active' | 'closed'>('active');

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorView message={q.error.message} onRetry={() => void q.refetch()} />;

  const active = q.data.filter((r) => !closedStatuses.includes(r.status));
  const closed = q.data.filter((r) => closedStatuses.includes(r.status));
  const list = tab === 'active' ? active : closed;

  return (
    <main className="page">
      <div className="row row--between">
        <h1 className="h1">Заявки</h1>
        <ButtonLink to="/requests/new" size="sm">
          <IconPlus size={18} />
          Новая
        </ButtonLink>
      </div>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'active', label: `Активные · ${active.length}` },
          { value: 'closed', label: `Закрытые · ${closed.length}` },
        ]}
      />
      {list.length === 0 ? (
        <Empty title={tab === 'active' ? 'Открытых заявок нет' : 'Закрытых заявок нет'} />
      ) : (
        list.map((r) => (
          <Card key={r.id} to={`/requests/${r.id}`}>
            <div className="stack-8">
              <div className="row row--between">
                <div className="muted num">
                  № {r.number} · от {fmtDate(r.createdAt)}
                </div>
                <Chip tone={r.overdue ? 'danger' : statusTone[r.status]}>
                  {r.overdue ? 'Срок вышел' : statusLabel[r.status]}
                </Chip>
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{r.title}</div>
              <div className="muted">
                {r.locationText}
                {r.joinersCount > 0 && ` · ${r.joinersCount + 1} кв.`}
                {!closedStatuses.includes(r.status) && ` · срок до ${fmtDate(r.dueAt)}`}
              </div>
            </div>
          </Card>
        ))
      )}
    </main>
  );
}
