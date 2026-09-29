import { Navigate } from 'react-router-dom';
import { useHome, useMe } from '../../api/hooks';
import { Card, ErrorView, Loading, PageHeader, ProvenanceChip, RowLink } from '../../ui';
import { IconBuilding, IconPhone } from '../../ui/icons';

export function House() {
  const me = useMe();
  const home = useHome(me.data?.house?.id);
  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );
  if (!me.data.house) return <Navigate to="/bind" replace />;
  if (home.isPending) return <Loading />;
  if (home.isError)
    return (
      <ErrorView
        error={home.error}
        message={home.error.message}
        onRetry={() => void home.refetch()}
      />
    );
  const h = home.data;
  return (
    <main className="page">
      <PageHeader
        hero
        eyebrow="Мой дом"
        title={h.house.address}
        subtitle={h.org ? `Управляет ${h.org.name}` : 'Управляющая организация не указана'}
      />
      <Card className="card__section">
        <div className="row" style={{ gap: 12 }}>
          <span className="icon-sq" aria-hidden="true">
            <IconBuilding size={20} />
          </span>
          <div className="grow list-item__title">Паспорт дома</div>
          <ProvenanceChip value={h.house.dataKind} />
        </div>
        <div className="muted">
          Характеристики, тарифы и капремонт появятся позже. Официальный источник для них — ГИС ЖКХ
          и Госуслуги.Дом, мы их не дублируем.
        </div>
      </Card>
      {h.org?.address && (
        <div className="stack-8">
          <h2 className="h2">Офис УК</h2>
          <Card className="card__section">
            <div className="list-item__title">{h.org.name}</div>
            <div className="muted">{h.org.address}</div>
          </Card>
        </div>
      )}
      <Card pad={false} className="list">
        <RowLink
          to="/contacts"
          icon={<IconPhone size={20} />}
          tone="ok"
          title="Контакты и график"
          sub="Диспетчер, офис УК, аварийная служба"
        />
      </Card>
    </main>
  );
}
