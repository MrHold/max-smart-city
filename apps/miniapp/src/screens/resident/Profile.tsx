import { useNavigate } from 'react-router-dom';
import { useBecomeDispatcher, useMe } from '../../api/hooks';
import { getPlatform, isMockBridge } from '../../bridge';
import { isDemoMode } from '../../clock';
import { DemoClockControl } from '../../clock/DemoClockControl';
import { Button, ButtonLink, Card, ErrorView, Loading, PageHeader, RowLink } from '../../ui';
import { IconBuilding, IconHome, IconUser, IconUsers } from '../../ui/icons';

const roleLabel: Record<string, string> = {
  resident: 'Житель',
  dispatcher: 'Диспетчер',
  executor: 'Исполнитель',
  none: 'нет',
};

export function Profile() {
  const me = useMe();
  const become = useBecomeDispatcher();
  const navigate = useNavigate();
  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );
  const aptNo = (me.data.apartmentLabel ?? '').replace(/^кв\.?\s*/i, '');

  return (
    <main className="page">
      <PageHeader hero title="Профиль" subtitle="Вход по аккаунту MAX, без регистрации" />

      <div className="stack-8">
        <h2 className="h2">Мой дом</h2>
        <Card pad={false} className="list">
          {me.data.house ? (
            <RowLink
              to="/house"
              icon={<IconBuilding size={20} />}
              title={aptNo ? `Квартира ${aptNo}` : 'Моя квартира'}
              sub={me.data.house.address}
            />
          ) : (
            <div className="row-link">
              <span className="row-link__text">
                <span className="row-link__title">Дом не привязан</span>
                <span className="row-link__sub">Привяжите дом, чтобы подавать заявки</span>
              </span>
            </div>
          )}
          <RowLink
            to="/bind"
            icon={<IconHome size={20} />}
            tone="neutral"
            title={me.data.house ? 'Сменить дом' : 'Привязать дом'}
          />
        </Card>
      </div>

      <div className="stack-8">
        <h2 className="h2">Управляющая организация</h2>
        <Card className="card__section">
          <div className="row" style={{ gap: 12 }}>
            <span className="icon-sq icon-sq--warn" aria-hidden="true">
              <IconUsers size={20} />
            </span>
            <div className="grow stack">
              <div className="list-item__title">Роль: {roleLabel[me.data.role ?? 'none']}</div>
              <div className="muted">
                {me.data.role === 'dispatcher'
                  ? 'Вам доступны входящие по домам организации.'
                  : isDemoMode
                    ? 'Демо: заявку со стороны УК можно открыть этим же аккаунтом.'
                    : 'Роль диспетчера выдаёт управляющая организация.'}
              </div>
            </div>
          </div>
          {me.data.role === 'dispatcher' ? (
            <ButtonLink to="/dispatcher">Кабинет диспетчера</ButtonLink>
          ) : isDemoMode ? (
            <Button
              variant="secondary"
              loading={become.isPending}
              onClick={() => become.mutate(undefined, { onSuccess: () => navigate('/dispatcher') })}
            >
              Стать диспетчером
            </Button>
          ) : null}
          {become.isError && (
            <div className="field__error" role="alert">
              {become.error.message}
            </div>
          )}
        </Card>
      </div>

      <div className="stack-8">
        <h2 className="h2">Персональные данные</h2>
        <Card pad={false} className="list">
          <RowLink
            to="/profile/data"
            icon={<IconUser size={20} />}
            tone="ok"
            title="Мои данные"
            sub="Что хранится и как удалить всё без письма оператору"
          />
        </Card>
      </div>

      {isDemoMode && (
        <Card>
          <DemoClockControl />
        </Card>
      )}

      <div className="hint">
        Платформа: {getPlatform()}
        {isMockBridge() ? ' (mock)' : ''}. Согласие на обработку данных дано в боте при первом
        входе. Персональные данные соседям не показываются.
      </div>
    </main>
  );
}
