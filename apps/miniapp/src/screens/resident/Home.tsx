import { Link, Navigate } from 'react-router-dom';
import { useHome, useMe, useMyRequests, useRequest } from '../../api/hooks';
import { fmtDate } from '../../lib/format';
import { closedStatuses } from '../../lib/request';
import {
  ButtonLink,
  CallButton,
  Card,
  Chip,
  ErrorView,
  formatRub,
  Loading,
  PageHeader,
  SectionHeader,
} from '../../ui';
import { IconBuilding, IconChevron, IconPlus, IconWarning } from '../../ui/icons';
import { RequestRow } from './RequestRow';

function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return 'Доброй ночи';
  if (h < 12) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  if (h < 23) return 'Добрый вечер';
  return 'Доброй ночи';
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

  const name = me.data.user.firstName || 'сосед';
  const aptNo = (me.data.apartmentLabel ?? '').replace(/^кв\.?\s*/i, '');
  const overdue = active.filter((r) => r.overdue).length;
  const nearestDue = active
    .map((r) => r.dueAt)
    .sort()
    .at(0);
  const kopecks = detail.data?.liability?.apartmentKopecks ?? 0;
  const dispatcher = home.data?.contacts.find((c) => c.kind === 'dispatcher');
  const emergency = home.data?.contacts.find((c) => c.kind === 'emergency');
  const org = home.data?.org;

  return (
    <main className="page">
      <PageHeader hero eyebrow={greeting()} title={name} />

      {/* Разделы уже есть в таббаре — здесь только главное действие */}
      <Card className="card__section">
        <Link to="/house" className="flat">
          <div className="grow stack">
            <div className="flat__title">{aptNo ? `Квартира ${aptNo}` : 'Моя квартира'}</div>
            <div className="muted">{me.data.house.address}</div>
          </div>
          <IconChevron size={20} className="chev" />
        </Link>
        <ButtonLink to="/requests/new" size="lg" stretched>
          <IconPlus size={20} />
          Сообщить о проблеме
        </ButtonLink>
        {me.data.role === 'dispatcher' && (
          <ButtonLink to="/dispatcher" variant="secondary" stretched>
            Кабинет диспетчера
          </ButtonLink>
        )}
      </Card>

      <div className="duo">
        <Link to="/requests" className="card card--pad status-card">
          <span className="status-card__title">Заявки</span>
          {requests.isPending ? (
            <Chip>…</Chip>
          ) : overdue > 0 ? (
            <Chip tone="danger" solid>
              {overdue} с просрочкой
            </Chip>
          ) : active.length > 0 ? (
            <Chip tone="accent" solid>
              {active.length} в работе
            </Chip>
          ) : (
            <Chip>нет открытых</Chip>
          )}
          <span className="status-card__cap">
            {overdue > 0
              ? 'Срок ответа УК вышел'
              : nearestDue
                ? `Ближайший срок ${fmtDate(nearestDue)}`
                : 'Сообщите, если что-то не так'}
          </span>
        </Link>
        <Link
          to={first ? `/requests/${first.id}` : '/requests'}
          className="card card--pad status-card"
        >
          <span className="status-card__title">Перерасчёт</span>
          {kopecks > 0 ? (
            <Chip tone="ok" solid>
              {formatRub(kopecks)}
            </Chip>
          ) : (
            <Chip>пока нет</Chip>
          )}
          <span className="status-card__cap">
            {kopecks > 0 && first
              ? `Вам положено по заявке № ${first.number}`
              : 'Начисляется, если нарушение дольше нормы'}
          </span>
        </Link>
      </div>

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

      <div className="stack-8">
        <SectionHeader
          title="Мои заявки"
          action={active.length ? `Все · ${active.length}` : 'Все'}
          to="/requests"
        />
        {requests.isPending ? (
          <Loading compact />
        ) : active.length > 0 ? (
          active.slice(0, 2).map((r) => <RequestRow key={r.id} r={r} />)
        ) : (
          <Card>
            <div className="muted">
              Открытых заявок нет. Если что-то сломалось, нажмите «Сообщить о проблеме».
            </div>
          </Card>
        )}
      </div>

      {home.data?.house.dataKind === 'model' && (
        <div className="hint">
          Контакты и данные дома — <Link to="/house">модельные</Link>, для демонстрации.
        </div>
      )}
    </main>
  );
}
