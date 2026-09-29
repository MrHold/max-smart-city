import { useState } from 'react';
import { useMyRequests } from '../../api/hooks';
import { closedStatuses } from '../../lib/request';
import { ButtonLink, Empty, ErrorView, Loading, PageHeader, Segmented } from '../../ui';
import { IconList, IconPlus } from '../../ui/icons';
import { RequestRow } from './RequestRow';

export function Requests() {
  const q = useMyRequests();
  const [tab, setTab] = useState<'active' | 'closed'>('active');

  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorView error={q.error} message={q.error.message} onRetry={() => void q.refetch()} />;

  const active = q.data.filter((r) => !closedStatuses.includes(r.status));
  const closed = q.data.filter((r) => closedStatuses.includes(r.status));
  const list = tab === 'active' ? active : closed;

  return (
    <main className="page">
      <PageHeader
        hero
        title="Заявки"
        subtitle="Ваши заявки и те, к которым вы присоединились"
        actions={
          <ButtonLink to="/requests/new" variant="secondary" className="btn--on-hero">
            <IconPlus size={16} />
            Новая
          </ButtonLink>
        }
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: `Активные · ${active.length}` },
            { value: 'closed', label: `Закрытые · ${closed.length}` },
          ]}
        />
      </PageHeader>
      {list.length === 0 ? (
        <Empty
          icon={<IconList size={34} />}
          title={tab === 'active' ? 'Открытых заявок нет' : 'Закрытых заявок нет'}
          text={
            tab === 'active'
              ? 'Если что-то сломалось в доме, создайте заявку: соседи смогут присоединиться.'
              : 'Здесь появятся заявки, которые вы подтвердили или УК отклонила.'
          }
        >
          {tab === 'active' && (
            <ButtonLink to="/requests/new">
              <IconPlus size={18} />
              Сообщить о проблеме
            </ButtonLink>
          )}
        </Empty>
      ) : (
        list.map((r) => <RequestRow key={r.id} r={r} />)
      )}
    </main>
  );
}
