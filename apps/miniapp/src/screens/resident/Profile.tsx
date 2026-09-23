import { useMe } from '../../api/hooks';
import { getPlatform, isMockBridge } from '../../bridge';
import { DemoClockControl } from '../../clock/DemoClockControl';
import { ButtonLink, Card, ErrorView, Loading, PageHeader, Stat } from '../../ui';

export function Profile() {
  const me = useMe();
  if (me.isPending) return <Loading />;
  if (me.isError) return <ErrorView message={me.error.message} onRetry={() => void me.refetch()} />;
  return (
    <main className="page">
      <PageHeader title="Профиль" subtitle="Вход по аккаунту MAX, без регистрации" />
      <Card className="card__section">
        <div className="eyebrow">Мой дом</div>
        {me.data.house ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{me.data.house.address}</div>
            <div className="muted">{me.data.house.apartmentLabel}</div>
          </>
        ) : (
          <div className="muted">Дом не привязан</div>
        )}
        <ButtonLink to="/bind" variant="secondary" size="sm">
          {me.data.house ? 'Сменить дом' : 'Привязать дом'}
        </ButtonLink>
      </Card>
      <div className="stats">
        <Stat small value={me.data.role} label="роль" />
        <Stat
          small
          value={`${getPlatform()}${isMockBridge() ? ' (mock)' : ''}`}
          label="платформа"
        />
      </div>
      <Card>
        <DemoClockControl />
      </Card>
      <div className="hint">
        Согласие на обработку данных дано в боте при первом входе. Персональные данные соседям не
        показываются.
      </div>
    </main>
  );
}
