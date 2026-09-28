import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useHome, useMe } from '../../api/hooks';
import type { Contact, Schedule } from '../../api/types';
import { useBackButton } from '../../bridge/back';
import { Button, Card, Chip, ErrorView, Loading, PageHeader, Stat } from '../../ui';

const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function scheduleText(s: Schedule | null): string {
  if (!s) return 'круглосуточно';
  const days = s.days.map((d) => dayNames[d - 1] ?? '').filter(Boolean);
  const range = days.length > 2 ? `${days[0]}–${days[days.length - 1]}` : days.join(', ');
  return `${range} ${s.from}–${s.to}`;
}

function PhoneActions({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="row">
      <a className="btn btn--primary grow" href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
        Позвонить
      </a>
      <Button variant="secondary" onClick={copy}>
        {copied ? 'Скопировано' : 'Скопировать'}
      </Button>
    </div>
  );
}

function ContactCard({ c, orgName }: { c: Contact; orgName?: string }) {
  if (c.kind === 'emergency') {
    return (
      <div
        className="banner banner--danger"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}
      >
        <div className="row row--between">
          <div className="list-item__title">Аварийная служба</div>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Круглосуточно</span>
        </div>
        <div className="num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
          {c.phone}
        </div>
        <div style={{ fontSize: 13, color: '#4a2a20' }}>
          Протечка, прорыв трубы, нет света во всём доме, засор канализации. Запах газа — сразу 104.
        </div>
        <a className="btn btn--danger" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>
          Позвонить в аварийную
        </a>
      </div>
    );
  }
  const title = c.kind === 'dispatcher' ? 'Диспетчер УК' : (orgName ?? 'Офис УК');
  return (
    <Card className="card__section">
      <div className="row row--between" style={{ alignItems: 'flex-start' }}>
        <div className="stack">
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>
            {c.phone}
          </div>
        </div>
        {c.open && (
          <Chip tone={c.open.isOpen ? 'ok' : 'neutral'}>
            {c.open.isOpen ? 'На связи' : 'Закрыто'}
          </Chip>
        )}
      </div>
      <div className="row" style={{ fontSize: 13 }}>
        <span className="muted">График</span>
        <span className="num" style={{ fontWeight: 600 }}>
          {scheduleText(c.schedule)}
        </span>
      </div>
      <PhoneActions phone={c.phone} />
    </Card>
  );
}

export function Contacts() {
  const navigate = useNavigate();
  useBackButton(() => navigate('/'));
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

  const now = new Date(home.data.now);
  const nowText = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);

  return (
    <main className="page">
      <PageHeader title="Контакты" subtitle={`Сейчас ${nowText} · местное время дома`} />
      {home.data.contacts.map((c) => (
        <ContactCard key={c.kind} c={c} orgName={home.data.org?.name} />
      ))}
      <div className="stats">
        <Stat value="112" label="Единая служба спасения" />
        <Stat value="104" label="Аварийная газовая служба" />
      </div>
    </main>
  );
}
