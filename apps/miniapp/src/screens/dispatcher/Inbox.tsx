import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useDispatcherInbox, useMe } from '../../api/hooks';
import type { ClusterCard, DispatcherInbox as Inbox } from '../../api/types';
import { useBackButton } from '../../bridge/back';
import { demoClock, useDemoOffset } from '../../clock';
import { fmtDuration, plural } from '../../lib/format';
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
  PageHeader,
  Segmented,
  Stat,
} from '../../ui';
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

/** В кабинете «новая», а не «отправлена»: диспетчер смотрит на входящие, а не отправляет. */
const cabinetStatus = (s: ClusterCard['status']) => (s === 'new' ? 'Новая' : statusLabel[s]);

function ClusterRow({ c, on }: { c: ClusterCard; on: boolean }) {
  useDemoOffset();
  const left = new Date(c.dueAt).getTime() - demoClock.now().getTime();
  const overdue = c.status !== 'done' && (c.overdue || left < 0);
  return (
    <Link
      to={`/dispatcher/c/${encodeURIComponent(c.key)}`}
      className={cx('list-item', 'list-item--link', 'cluster-row', on && 'cluster-row--on')}
    >
      <div className="grow stack" style={{ gap: 4 }}>
        <div className="row row--between">
          <div className="list-item__title">{c.title}</div>
          <Chip xs tone={overdue ? 'danger' : statusTone[c.status]}>
            {overdue ? 'Срок вышел' : cabinetStatus(c.status)}
          </Chip>
        </div>
        <div className="list-item__sub">
          {c.houseAddress} · {c.apartments}{' '}
          {plural(c.apartments, 'квартира', 'квартиры', 'квартир')}
        </div>
        <div className="row row--between" style={{ fontSize: 13 }}>
          <span className={cx('num', overdue ? 'status-line--danger' : 'muted')}>
            {c.status === 'done'
              ? 'ждёт подтверждения'
              : overdue
                ? `просрочено на ${fmtDuration(left)}`
                : `осталось ${fmtDuration(left)}`}
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
      <div className="stats">
        <Stat small value={String(fresh)} label="новых" />
        <Stat
          small
          value={String(overdue)}
          label="просрочено"
          tone={overdue > 0 ? 'danger' : undefined}
        />
        <Stat small value={formatRub(inbox.totalKopecks)} label="цена простоя по домам" />
        <Stat
          small
          value={`+${formatRub(inbox.totalPerHourKopecks)} / ч`}
          label="растёт каждый час без ремонта"
        />
      </div>
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
        <Empty title="Входящих нет" text="Открытых заявок этого вида нет" />
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
  useBackButton(() => navigate(key || executorsTab ? '/dispatcher' : '/'));

  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );

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
      <PageHeader
        hero
        backTo="/"
        eyebrow={inbox.data?.orgName ?? 'Управляющая организация'}
        title="Кабинет диспетчера"
      >
        <div style={{ maxWidth: 360 }}>
          <Segmented<'inbox' | 'executors'>
            value={executorsTab ? 'executors' : 'inbox'}
            onChange={(v) => navigate(v === 'inbox' ? '/dispatcher' : '/dispatcher/executors')}
            options={[
              { value: 'inbox', label: 'Входящие' },
              { value: 'executors', label: 'Исполнители' },
            ]}
          />
        </div>
      </PageHeader>

      {executorsTab ? (
        <Executors houseId={me.data.house?.id} />
      ) : inbox.isPending ? (
        <Loading />
      ) : inbox.isError ? (
        <ErrorView
          error={inbox.error}
          message={inbox.error.message}
          onRetry={() => void inbox.refetch()}
        />
      ) : (
        <div className={cx('cab__grid', wide && 'cab__grid--wide')}>
          {showList && <ClusterList inbox={inbox.data} selectedKey={key} />}
          {key ? (
            <ClusterPanel
              key={key}
              cluster={selected}
              loading={inbox.isFetching && !selected}
              onClose={() => navigate('/dispatcher')}
            />
          ) : (
            wide && (
              <Card className="cab__panel">
                <Empty
                  title="Выберите заявку"
                  text="Заявки сгруппированы по проблеме: одна авария в доме — одна строка"
                />
              </Card>
            )
          )}
        </div>
      )}
    </main>
  );
}
