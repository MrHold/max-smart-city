import { Link, Navigate } from 'react-router-dom';
import { useHome, useMe, useMyRequests } from '../../api/hooks';
import type { Contact } from '../../api/types';
import { fmtDate } from '../../lib/format';
import { closedStatuses, statusLabel, statusTone } from '../../lib/request';
import { ButtonLink, CallButton, Card, Chip, ErrorView, Loading, SectionHeader } from '../../ui';
import { IconChevron, IconPlus } from '../../ui/icons';

const contactTitle: Record<Contact['kind'], string> = {
  dispatcher: 'Диспетчер УК',
  office: 'Офис управляющей компании',
  emergency: 'Аварийная служба',
};

function ContactRow({ c }: { c: Contact }) {
  const emergency = c.kind === 'emergency';
  return (
    <div className="list-item">
      <div className="grow stack">
        <div className="list-item__title">{contactTitle[c.kind]}</div>
        {emergency ? (
          <div className="status-line status-line--danger">Круглосуточно · протечка, нет света</div>
        ) : c.open ? (
          <div
            className={`status-line ${c.open.isOpen ? 'status-line--ok' : 'status-line--muted'}`}
          >
            <span className="dot" />
            {c.open.isOpen ? `На связи до ${c.open.until ?? ''}` : 'Сейчас закрыто'}
          </div>
        ) : null}
      </div>
      <CallButton
        phone={c.phone}
        tone={emergency ? 'danger' : c.kind === 'office' ? 'outline' : 'primary'}
        label={`Позвонить: ${contactTitle[c.kind]}`}
      />
    </div>
  );
}

export function Home() {
  const me = useMe();
  const houseId = me.data?.house?.id;
  const home = useHome(houseId);
  const requests = useMyRequests();

  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );
  if (!me.data.house) return <Navigate to="/bind" replace />;

  const active = (requests.data ?? []).filter((r) => !closedStatuses.includes(r.status));
  const first = active[0];

  return (
    <main className="page">
      <div className="stack">
        <div className="eyebrow">Ваш дом</div>
        <h1 className="h1 h1--lg">{me.data.house.address}</h1>
        <div className="muted">
          {me.data.apartmentLabel}
          {home.data?.org && ` · ${home.data.org.name}`}
        </div>
      </div>

      {me.data.role === 'dispatcher' && (
        <Link to="/dispatcher" className="banner banner--accent">
          <div className="grow" style={{ fontSize: 14 }}>
            <strong>Кабинет диспетчера</strong> — входящие по домам организации
          </div>
          <IconChevron size={18} />
        </Link>
      )}

      <div className="stack-8">
        <SectionHeader title="Контакты" action="График" to="/contacts" />
        {home.isPending ? (
          <Loading />
        ) : home.isError ? (
          <ErrorView
            error={home.error}
            message={home.error.message}
            onRetry={() => void home.refetch()}
          />
        ) : (
          <Card pad={false} className="list">
            {home.data.contacts.map((c) => (
              <ContactRow key={c.kind} c={c} />
            ))}
          </Card>
        )}
      </div>

      <ButtonLink to="/requests/new" size="lg" stretched>
        <IconPlus />
        Сообщить о проблеме
      </ButtonLink>

      <div className="stack-8">
        <SectionHeader
          title="Мои заявки"
          action={active.length ? `Все · ${active.length}` : 'Все'}
          to="/requests"
        />
        {first ? (
          <Card to={`/requests/${first.id}`}>
            <div className="stack-8">
              <div className="row row--between">
                <div className="list-item__title">{first.title}</div>
                <Chip tone={first.overdue ? 'danger' : statusTone[first.status]}>
                  {first.overdue ? 'Срок вышел' : statusLabel[first.status]}
                </Chip>
              </div>
              <div className="muted num">
                № {first.number} · срок до {fmtDate(first.dueAt)}
                {first.joinersCount > 0 && ` · ${first.joinersCount + 1} кв.`}
              </div>
            </div>
          </Card>
        ) : (
          <Card>
            <div className="muted">Открытых заявок нет</div>
          </Card>
        )}
      </div>

      {home.data?.announcement && (
        <div className="banner banner--warn">
          <div className="eyebrow">{home.data.announcement.title}</div>
          <div>{home.data.announcement.text}</div>
        </div>
      )}

      {home.data?.house.dataKind === 'model' && (
        <div className="hint">
          Контакты и данные дома — <Link to="/house">модельные</Link>, для демонстрации.
        </div>
      )}
    </main>
  );
}
