import { useHome, useMe } from '../../api/hooks';
import { Card, ErrorView, Loading, PageHeader, ProvenanceChip } from '../../ui';

export function House() {
  const me = useMe();
  const home = useHome(me.data?.house?.id);
  if (me.isPending || home.isPending) return <Loading />;
  if (me.isError) return <ErrorView message={me.error.message} onRetry={() => void me.refetch()} />;
  if (home.isError)
    return <ErrorView message={home.error.message} onRetry={() => void home.refetch()} />;
  const h = home.data;
  return (
    <main className="page">
      <PageHeader
        title={h.house.address}
        subtitle={h.org ? `Управляет ${h.org.name}` : 'Управляющая организация не указана'}
      />
      <Card className="card__section">
        <div className="row row--between">
          <div style={{ fontSize: 16, fontWeight: 600 }}>Паспорт дома</div>
          <ProvenanceChip value={h.house.dataKind} />
        </div>
        <div className="muted">
          Характеристики, тарифы и капремонт — Should Have. Официальный источник для них — ГИС ЖКХ и
          Госуслуги.Дом, мы их не дублируем.
        </div>
      </Card>
      {h.org?.address && (
        <Card className="card__section">
          <div className="eyebrow">Офис УК</div>
          <div>{h.org.address}</div>
        </Card>
      )}
    </main>
  );
}
