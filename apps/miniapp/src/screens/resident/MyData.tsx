import type { DeleteMeResult } from '@msc/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeleteMe, useMyData } from '../../api/hooks';
import { useBackButton } from '../../bridge/back';
import { fmtDate } from '../../lib/format';
import { Button, Card, ErrorView, Loading, PageHeader } from '../../ui';

function Done({ result }: { result: DeleteMeResult }) {
  const navigate = useNavigate();
  const d = result.deleted;
  return (
    <main className="page">
      <PageHeader
        eyebrow="Готово"
        title="Данные удалены"
        subtitle="Приложение больше ничего о вас не знает"
      />
      <Card className="card__section">
        <div className="steps-list">
          <Row label="Привязка к дому" value={d.memberships} />
          <Row label="Согласия" value={d.consents} />
          <Row label="Присоединения к заявкам" value={d.joins} />
          <Row label="Уведомления" value={d.notifications} />
          <Row label="Заявок обезличено" value={result.anonymizedRequests} />
        </div>
        <div className="hint">
          Заявки остались у дома без связи с вами: соседям, которые к ним присоединились, они всё
          ещё нужны.
        </div>
      </Card>
      <Button stretched onClick={() => navigate('/bind', { replace: true })}>
        Начать заново
      </Button>
    </main>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="step-row">
      <div className="grow">{label}</div>
      <span className="step-row__value">{value}</span>
    </div>
  );
}

export function MyData() {
  const navigate = useNavigate();
  useBackButton(() => navigate('/profile'));
  const q = useMyData();
  const del = useDeleteMe();
  const [confirming, setConfirming] = useState(false);

  if (del.isSuccess) return <Done result={del.data} />;
  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorView error={q.error} message={q.error.message} onRetry={() => void q.refetch()} />;
  const d = q.data;

  return (
    <main className="page">
      <PageHeader
        eyebrow="Персональные данные"
        title="Что о вас хранится"
        subtitle={`Идентификатор ${d.userId.slice(0, 8)}… · с ${fmtDate(d.createdAt)}`}
      />

      <Card pad={false} className="list">
        {d.items.map((item) => (
          <div className="list-item" key={item.label}>
            <div className="grow stack">
              <div className="row row--between">
                <div className="list-item__title">{item.label}</div>
                <span className="chip chip--neutral">{item.count}</span>
              </div>
              <div className="list-item__sub">{item.purpose}</div>
              {item.values?.some(Boolean) && (
                <div className="hint num">{item.values.filter(Boolean).join(' · ')}</div>
              )}
            </div>
          </div>
        ))}
      </Card>

      <div className="hint">
        Настоящий идентификатор MAX в базе не хранится — только его хеш и шифротекст. Имя и телефон
        не сохраняются вовсе.
      </div>

      <div className="banner banner--warn">
        <div className="eyebrow">Что произойдёт при удалении</div>
        <div>{d.deletionNotice}</div>
      </div>

      {confirming ? (
        <Card className="card__section card--accent">
          <div style={{ fontWeight: 600 }}>Удалить всё безвозвратно?</div>
          <div className="row">
            <Button
              variant="danger"
              className="grow"
              loading={del.isPending}
              onClick={() => del.mutate()}
            >
              Да, удалить
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Отмена
            </Button>
          </div>
          {del.isError && <div className="field__error">{del.error.message}</div>}
        </Card>
      ) : (
        <Button variant="secondary" stretched onClick={() => setConfirming(true)}>
          Удалить всё
        </Button>
      )}
    </main>
  );
}
