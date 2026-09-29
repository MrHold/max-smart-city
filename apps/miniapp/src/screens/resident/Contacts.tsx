import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useHome, useMe } from '../../api/hooks';
import type { Contact, Schedule } from '../../api/types';
import { useBackButton } from '../../bridge/back';
import { CallButton, Card, ErrorView, Loading, PageHeader, Stat } from '../../ui';
import { IconCheck, IconCopy } from '../../ui/icons';

const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function scheduleText(s: Schedule | null): string {
  if (!s) return 'круглосуточно';
  const days = s.days.map((d) => dayNames[d - 1] ?? '').filter(Boolean);
  const range = days.length > 2 ? `${days[0]}–${days[days.length - 1]}` : days.join(', ');
  return `${range} ${s.from}–${s.to}`;
}

function PhoneCopy({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      type="button"
      className="link-btn contact__phone num"
      onClick={() => void copy()}
      aria-label={copied ? 'Номер скопирован' : 'Скопировать номер'}
    >
      {phone}
      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
    </button>
  );
}

function ContactRow({ c, orgName }: { c: Contact; orgName?: string }) {
  const title = c.kind === 'dispatcher' ? 'Диспетчер УК' : (orgName ?? 'Офис УК');
  return (
    <div className="list-item">
      <div className="grow stack">
        <div className="list-item__title">{title}</div>
        <PhoneCopy phone={c.phone} />
        {c.open ? (
          <div
            className={`status-line ${c.open.isOpen ? 'status-line--ok' : 'status-line--muted'}`}
          >
            <span className="dot" />
            {c.open.isOpen ? 'На связи' : 'Закрыто'} · {scheduleText(c.schedule)}
          </div>
        ) : (
          <div className="list-item__sub">{scheduleText(c.schedule)}</div>
        )}
      </div>
      <CallButton phone={c.phone} label={`Позвонить: ${title}`} />
    </div>
  );
}

function EmergencyRow({ c }: { c: Contact }) {
  return (
    <div className="banner banner--danger">
      <div className="grow stack">
        <span className="list-item__title">Аварийная служба</span>
        <div className="num contact__phone">{c.phone}</div>
        <div className="contact__note">
          Круглосуточно. Протечка, прорыв трубы, нет света во всём доме. Запах газа — сразу 104.
        </div>
      </div>
      <CallButton phone={c.phone} tone="danger" label="Позвонить в аварийную службу" />
    </div>
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
  const regular = home.data.contacts.filter((c) => c.kind !== 'emergency');
  const emergency = home.data.contacts.find((c) => c.kind === 'emergency');

  return (
    <main className="page">
      <PageHeader
        hero
        backTo="/"
        title="Контакты"
        subtitle={`Сейчас ${nowText}, местное время дома`}
      />
      {regular.length > 0 && (
        <Card pad={false} className="list">
          {regular.map((c) => (
            <ContactRow key={c.kind} c={c} orgName={home.data.org?.name} />
          ))}
        </Card>
      )}
      {emergency && <EmergencyRow c={emergency} />}
      <div className="stats">
        <Stat value="112" label="Единая служба спасения" small />
        <Stat value="104" label="Аварийная газовая служба" small />
      </div>
    </main>
  );
}
