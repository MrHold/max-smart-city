import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useDispatcherInbox, useMe } from '../../api/hooks';
import type { ClusterCard, DispatcherInbox as Inbox } from '../../api/types';
import { demoClock, useDemoOffset } from '../../clock';
import { fmtDate, plural } from '../../lib/format';
import { useMediaQuery } from '../../lib/media';
import { statusLabel, statusTone } from '../../lib/request';
import {
  ButtonLink,
  Card,
  Chip,
  cx,
  Empty,
  ErrorView,
  formatRub,
  Loading,
  Segmented,
  Stat,
} from '../../ui';
import { IconArrowLeft } from '../../ui/icons';
import { ClusterPanel } from './ClusterPanel';
import { Executors } from './Executors';

type Filter = 'new' | 'work' | 'all';
const workStatuses: ClusterCard['status'][] = [
  'accepted',
  'assigned',
  'in_progress',
  'done',
  'reopened',
];

function ClusterRow({ c, on }: { c: ClusterCard; on: boolean }) {
  useDemoOffset();
  const overdue =
    c.status !== 'done' && (c.overdue || new Date(c.dueAt).getTime() < demoClock.now().getTime());
  return (
    <Link
      to={`/dispatcher/c/${encodeURIComponent(c.key)}`}
      className={cx('list-item', 'list-item--link', 'cluster-row', on && 'cluster-row--on')}
    >
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="row row--between">
          <div className="list-item__title">{c.title}</div>
          <Chip xs tone={overdue ? 'danger' : statusTone[c.status]}>
            {overdue ? 'Срок вышел' : statusLabel[c.status]}
          </Chip>
        </div>
        <div className="list-item__sub">
          {c.houseAddress} · {c.apartments}{' '}
          {plural(c.apartments, 'квартира', 'квартиры', 'квартир')}
        </div>
        <div className="row row--between" style={{ fontSize: 13 }}>
          <span className={cx('num', overdue ? 'status-line--danger' : 'muted')}>
            срок до {fmtDate(c.dueAt)}
          </span>
          {c.kopecks > 0 && (
            <span className="num" style={{ fontWeight: 600 }}>
              {formatRub(c.kopecks)} · +{formatRub(c.perHourKopecks)}/ч
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function ClusterList({ inbox, selectedKey }: { inbox: Inbox; selectedKey?: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  useDemoOffset();
  const now = demoClock.now().getTime();
  const isOverdue = (c: ClusterCard) =>
    c.status !== 'done' && (c.overdue || new Date(c.dueAt).getTime() < now);
  const all = [...inbox.clusters].sort(
    (a, b) =>
      Number(isOverdue(b)) - Number(isOverdue(a)) ||
      new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
  );
  const fresh = all.filter((c) => c.status === 'new').length;
  const overdue = all.filter(isOverdue).length;
  const shown = all.filter((c) =>
    filter === 'new'
      ? c.status === 'new'
      : filter === 'work'
        ? workStatuses.includes(c.status)
        : true,
  );

  return (
    <div className="stack">
      <div className="stats stats--3">
        <Stat small value={String(fresh)} label="новых" />
        <Stat small value={String(overdue)} label="просрочено" />
        <Stat small value={formatRub(inbox.totalKopecks)} label="цена простоя" />
      </div>
      {inbox.totalPerHourKopecks > 0 && (
        <div className="hint">
          Каждый час без ремонта прибавляет {formatRub(inbox.totalPerHourKopecks)} к перерасчёту по
          всем домам.
        </div>
      )}
      <Segmented<Filter>
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'new', label: `Новые · ${fresh}` },
          { value: 'work', label: 'В работе' },
          { value: 'all', label: `Все · ${all.length}` },
        ]}
      />
      {shown.length === 0 ? (
        <Empty title="Пусто" text="Открытых заявок этого вида нет" />
      ) : (
        <Card pad={false} className="list">
          {shown.map((c) => (
            <ClusterRow key={c.key} c={c} on={c.key === selectedKey} />
          ))}
        </Card>
      )}
    </div>
  );
}

export function DispatcherInbox() {
  const me = useMe();
  const navigate = useNavigate();
  const { key } = useParams();
  const executorsTab = useLocation().pathname.endsWith('/executors');
  const wide = useMediaQuery('(min-width: 900px)');
  const isDispatcher = me.data?.role === 'dispatcher';
  const inbox = useDispatcherInbox(isDispatcher);

  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorView message={me.error.message} onRetry={() => void me.refetch()} />;

  if (!isDispatcher) {
    return (
      <main className="page page--no-tabbar">
        <Empty
          title="Кабинет диспетчера"
          text="У вашего аккаунта нет роли диспетчера. В демо-режиме её можно взять в профиле."
        />
        <ButtonLink to="/profile" variant="secondary">
          В профиль
        </ButtonLink>
      </main>
    );
  }

  const selected = key ? inbox.data?.clusters.find((c) => c.key === key) : undefined;
  const showList = wide || !key;

  return (
    <main className="page page--no-tabbar cab">
      <div className="stack-8">
        <Link to="/" className="back-link">
          <IconArrowLeft size={18} />
          Мой дом
        </Link>
        <div className="row row--between wrap">
          <div>
            <div className="eyebrow">{inbox.data?.orgName ?? 'Управляющая организация'}</div>
            <h1 className="h1">Кабинет диспетчера</h1>
          </div>
          <div style={{ minWidth: 240 }}>
            <Segmented<'inbox' | 'executors'>
              value={executorsTab ? 'executors' : 'inbox'}
              onChange={(v) => navigate(v === 'inbox' ? '/dispatcher' : '/dispatcher/executors')}
              options={[
                { value: 'inbox', label: 'Входящие' },
                { value: 'executors', label: 'Исполнители' },
              ]}
            />
          </div>
        </div>
      </div>

      {executorsTab ? (
        <Executors houseId={me.data.house?.id} />
      ) : inbox.isPending ? (
        <Loading />
      ) : inbox.isError ? (
        <ErrorView message={inbox.error.message} onRetry={() => void inbox.refetch()} />
      ) : (
        <div className={cx('cab__grid', wide && 'cab__grid--wide')}>
          {showList && <ClusterList inbox={inbox.data} selectedKey={key} />}
          {key ? (
            <ClusterPanel
              cluster={selected}
              loading={false}
              onClose={() => navigate('/dispatcher')}
            />
          ) : (
            wide && (
              <Card className="cab__panel">
                <Empty
                  title="Выберите заявку"
                  text="Слева входящие по причинам: одна авария в доме — одна строка"
                />
              </Card>
            )
          )}
        </div>
      )}
    </main>
  );
}
