import { Link, Navigate } from 'react-router-dom';
import { useHome, useMe, useMyRequests, useRequest } from '../../api/hooks';
import { closedStatuses } from '../../lib/request';
import {
  ButtonLink,
  CallButton,
  Card,
  ErrorView,
  formatRub,
  Loading,
  PageHeader,
  RowLink,
  SectionHeader,
} from '../../ui';
import { IconBuilding, IconPlus, IconUsers, IconWarning } from '../../ui/icons';
import { RequestRow } from './RequestRow';

/** «Казань, ул. Садовая, 12» → город в надзаголовок, улицу с домом крупно */
function splitAddress(address: string): [string, string] {
  const i = address.indexOf(', ');
  return i > 0 ? [address.slice(0, i), address.slice(i + 2)] : ['', address];
}

export function Home() {
  const me = useMe();
  const houseId = me.data?.house?.id;
  const home = useHome(houseId);
  const requests = useMyRequests();
  const active = (requests.data ?? []).filter((r) => !closedStatuses.includes(r.status));
  const first = active[0];
  // Сумма перерасчёта есть только в карточке заявки — берём её по первой открытой
  const detail = useRequest(first?.id, Boolean(first));

  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );
  if (!me.data.house) return <Navigate to="/bind" replace />;

  const [city, street] = splitAddress(me.data.house.address);
  const aptNo = (me.data.apartmentLabel ?? '').replace(/^кв\.?\s*/i, '');
  const kopecks = detail.data?.liability?.apartmentKopecks ?? 0;
  const dispatcher = home.data?.contacts.find((c) => c.kind === 'dispatcher');
  const emergency = home.data?.contacts.find((c) => c.kind === 'emergency');
  const org = home.data?.org;

  return (
    <main className="page">
      {/* Сверху дом и главное действие; разделы уже есть в таббаре */}
      <PageHeader
        hero
        eyebrow={[city, aptNo && `кв. ${aptNo}`].filter(Boolean).join(' · ')}
        title={street}
      >
        <ButtonLink
          to="/requests/new"
          variant="secondary"
          size="lg"
          stretched
          className="btn--light"
        >
          <IconPlus size={20} />
          Сообщить о проблеме
        </ButtonLink>
      </PageHeader>

      {me.data.role === 'dispatcher' && (
        <Card pad={false} className="list">
          <RowLink
            to="/dispatcher"
            icon={<IconUsers size={20} />}
            tone="warn"
            title="Кабинет диспетчера"
            sub="Входящие заявки по домам УК"
          />
        </Card>
      )}

      {/* Свои открытые заявки — выше справочного: срок и сумма и есть суть продукта */}
      {requests.isPending ? (
        <Loading compact />
      ) : requests.isError ? (
        <ErrorView
          error={requests.error}
          message={requests.error.message}
          onRetry={() => void requests.refetch()}
        />
      ) : active.length > 0 ? (
        <div className="stack-8">
          <SectionHeader title="Мои заявки" action={`Все · ${active.length}`} to="/requests" />
          {kopecks > 0 && first && (
            <Card pad={false} className="list">
              <RowLink
                to={`/requests/${first.id}`}
                icon={<span className="icon-sq__glyph">₽</span>}
                tone="ok"
                title="Перерасчёт"
                sub={`по заявке № ${first.number}`}
                value={<span className="row-link__money num">{formatRub(kopecks)}</span>}
              />
            </Card>
          )}
          {active.slice(0, 3).map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </div>
      ) : null}

      {home.data?.announcement && (
        <div className="notice">
          <div className="grow stack">
            <div className="notice__title">{home.data.announcement.title}</div>
            <div className="notice__text">{home.data.announcement.text}</div>
          </div>
          <span className="icon-sq icon-sq--warn" aria-hidden="true">
            <IconWarning size={20} />
          </span>
        </div>
      )}

      {home.isPending ? (
        <Loading compact />
      ) : home.isError ? (
        <ErrorView
          error={home.error}
          message={home.error.message}
          onRetry={() => void home.refetch()}
        />
      ) : (
        <>
          {org && (
            <Card className="card__section">
              <div className="row" style={{ gap: 12 }}>
                <span className="icon-sq" aria-hidden="true">
                  <IconBuilding size={20} />
                </span>
                <div className="grow stack">
                  <div className="list-item__title">{org.name}</div>
                  {dispatcher?.open ? (
                    <div
                      className={`status-line ${dispatcher.open.isOpen ? 'status-line--ok' : 'status-line--muted'}`}
                    >
                      <span className="dot" />
                      {dispatcher.open.isOpen
                        ? `Диспетчер на связи до ${dispatcher.open.until ?? ''}`
                        : 'Диспетчер сейчас не отвечает'}
                    </div>
                  ) : (
                    <div className="muted">Управляющая организация</div>
                  )}
                </div>
              </div>
              <div className="duo">
                {dispatcher && (
                  <a
                    className="btn btn--primary"
                    href={`tel:${dispatcher.phone.replace(/[^\d+]/g, '')}`}
                  >
                    Позвонить
                  </a>
                )}
                <ButtonLink to="/contacts" variant="secondary">
                  Все контакты
                </ButtonLink>
              </div>
            </Card>
          )}
          {emergency && (
            <div className="sos">
              <span className="icon-sq icon-sq--danger" aria-hidden="true">
                <IconWarning size={20} />
              </span>
              <div className="grow stack">
                <div className="list-item__title">Аварийная служба</div>
                <div className="sos__cap">Круглосуточно: протечка, нет света, запах газа</div>
              </div>
              <CallButton
                phone={emergency.phone}
                tone="danger"
                label="Позвонить в аварийную службу"
              />
            </div>
          )}
        </>
      )}

      {home.data?.house.dataKind === 'model' && (
        <div className="hint">
          Контакты и данные дома — <Link to="/house">модельные</Link>, для демонстрации.
        </div>
      )}
    </main>
  );
}
