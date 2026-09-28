import { useNavigate } from 'react-router-dom';
import { useBecomeDispatcher, useMe } from '../../api/hooks';
import { getPlatform, isMockBridge } from '../../bridge';
import { isDemoMode } from '../../clock';
import { DemoClockControl } from '../../clock/DemoClockControl';
import { Button, ButtonLink, Card, ErrorView, Loading, PageHeader, Stat } from '../../ui';

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
  return (
    <main className="page">
      <PageHeader title="Профиль" subtitle="Вход по аккаунту MAX, без регистрации" />
      <Card className="card__section">
        <div className="eyebrow">Мой дом</div>
        {me.data.house ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{me.data.house.address}</div>
            <div className="muted">{me.data.apartmentLabel}</div>
          </>
        ) : (
          <div className="muted">Дом не привязан</div>
        )}
        <ButtonLink to="/bind" variant="secondary" size="sm">
          {me.data.house ? 'Сменить дом' : 'Привязать дом'}
        </ButtonLink>
      </Card>
      <div className="stats">
        <Stat small value={roleLabel[me.data.role ?? 'none']} label="роль" />
        <Stat
          small
          value={`${getPlatform()}${isMockBridge() ? ' (mock)' : ''}`}
          label="платформа"
        />
      </div>
      <Card className="card__section">
        <div className="eyebrow">Управляющая организация</div>
        {me.data.role === 'dispatcher' ? (
          <>
            <div className="muted">Вам доступны входящие по домам организации.</div>
            <ButtonLink to="/dispatcher" size="sm">
              Кабинет диспетчера
            </ButtonLink>
          </>
        ) : isDemoMode ? (
          <>
            <div className="muted">
              Демо: посмотреть заявку со стороны УК можно этим же аккаунтом.
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={become.isPending}
              onClick={() => become.mutate(undefined, { onSuccess: () => navigate('/dispatcher') })}
            >
              Стать диспетчером
            </Button>
            {become.isError && <div className="field__error">{become.error.message}</div>}
          </>
        ) : (
          <div className="muted">Роль диспетчера выдаёт управляющая организация.</div>
        )}
      </Card>
      <Card className="card__section">
        <div className="eyebrow">Персональные данные</div>
        <div className="muted">
          Что хранится, зачем, и кнопка «Удалить всё» — без письма оператору.
        </div>
        <ButtonLink to="/profile/data" variant="secondary" size="sm">
          Мои данные
        </ButtonLink>
      </Card>
      {isDemoMode && (
        <Card>
          <DemoClockControl />
        </Card>
      )}
      <div className="hint">
        Согласие на обработку данных дано в боте при первом входе. Персональные данные соседям не
        показываются.
      </div>
    </main>
  );
}
