import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useConfirmRequest, useRequest } from '../../api/hooks';
import type { Liability, RequestDetail } from '../../api/types';
import { ensureWebApp } from '../../bridge';
import { demoClock, useDemoOffset } from '../../clock';
import { fmtDate, fmtDateTime, fmtDuration, initials, plural } from '../../lib/format';
import { buildTimeline, statusLabel, statusTone } from '../../lib/request';
import {
  Button,
  Card,
  Chip,
  ErrorView,
  formatRub,
  Loading,
  Money,
  ProvenanceChip,
  Stat,
  Timeline,
} from '../../ui';
import { IconCamera, IconClock, IconCopy, IconShare, IconUsers } from '../../ui/icons';

function Deadline({ r }: { r: RequestDetail }) {
  useDemoOffset();
  const left = new Date(r.dueAt).getTime() - demoClock.now().getTime();
  const overdue = r.overdue || left < 0;
  return (
    <span className={`status-line ${overdue ? 'status-line--danger' : 'status-line--muted'}`}>
      <IconClock size={14} />
      {overdue
        ? `Срок вышел ${fmtDuration(left)} назад`
        : `Срок — до ${fmtDate(r.dueAt)}, осталось ${fmtDuration(left)}`}
    </span>
  );
}

function ShareBlock({ r }: { r: RequestDetail }) {
  const [copied, setCopied] = useState(false);
  const total = r.joinersCount + 1;
  const share = async () => {
    const wa = ensureWebApp();
    const text = `${r.title} — ${r.locationText}. Если у вас так же, присоединяйтесь: ${r.shareUrl}`;
    if (wa.shareMaxContent) {
      try {
        await wa.shareMaxContent({ text });
        return;
      } catch {}
    }
    window.open(`https://max.ru/:share?text=${encodeURIComponent(text)}`, '_blank');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <Card className="card__section card--accent">
      <div className="row row--between">
        <div className="eyebrow eyebrow--accent">У меня тоже</div>
        <IconUsers size={18} style={{ color: 'var(--accent)' }} />
      </div>
      <div>
        <div className="money money--sm num">
          {total} {plural(total, 'квартира', 'квартиры', 'квартир')}
        </div>
        <div className="muted">
          {r.joinersCount > 0
            ? 'подтвердили, что проблема общая'
            : 'пока только вы — поделитесь в чате дома'}
        </div>
      </div>
      <div className="row">
        <Button className="grow" onClick={() => void share()}>
          <IconShare size={18} />
          Поделиться в чат дома
        </Button>
        <Button variant="secondary" onClick={() => void copy()} aria-label="Скопировать ссылку">
          {copied ? 'Есть' : <IconCopy size={18} />}
        </Button>
      </div>
      <div className="hint">
        Соседи откроют ссылку в MAX и присоединятся одной кнопкой. УК получит одну заявку с
        масштабом вместо десятков дублей.
      </div>
    </Card>
  );
}

function LiabilityBlock({ l }: { l: Liability }) {
  return (
    <Card className="card__section">
      <div className="row row--between">
        <div className="eyebrow">Перерасчёт</div>
        <ProvenanceChip value={l.steps.some((s) => s.provenance === 'model') ? 'model' : 'calc'} />
      </div>
      <div>
        <Money kopecks={l.apartmentKopecks} />
        <div className="muted">
          вам положено за {l.hours} {plural(Math.round(l.hours), 'час', 'часа', 'часов')} нарушения
        </div>
      </div>
      <div className="stats">
        <Stat small value={formatRub(l.houseKopecks)} label="по всем квартирам заявки" />
        <Stat
          small
          value={`+${formatRub(l.perHourHouseKopecks)} / ч`}
          label="растёт, пока не устранят"
        />
      </div>
      {l.thresholdReachedAt === null && (
        <div className="banner banner--accent">
          Допустимый перерыв ещё не превышен — перерасчёт начнётся после порога по ПП 354.
        </div>
      )}
      <details>
        <summary className="muted" style={{ cursor: 'pointer' }}>
          Как посчитано
        </summary>
        <div className="steps-list" style={{ marginTop: 8 }}>
          {l.steps.map((s) => (
            <div className="step-row" key={s.label}>
              <div className="grow">
                <div>{s.label}</div>
                {s.ref && (
                  <div className="hint">
                    {s.ref.act}, {s.ref.point}
                  </div>
                )}
              </div>
              <ProvenanceChip value={s.provenance} />
              <span className="step-row__value">
                {s.value.toLocaleString('ru-RU')} {s.unit}
              </span>
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Правила версии {l.rulesVersion}. Сумма по дому — оценка: площади соседей неизвестны.
        </div>
      </details>
    </Card>
  );
}

export function RequestCard() {
  const { id } = useParams();
  const q = useRequest(id);
  const confirm = useConfirmRequest(id ?? '');

  if (q.isPending) return <Loading />;
  if (q.isError) return <ErrorView message={q.error.message} onRetry={() => void q.refetch()} />;
  const r = q.data;

  return (
    <main className="page">
      <div className="stack" style={{ gap: 6 }}>
        <div className="muted num">
          Заявка № {r.number} · от {fmtDateTime(r.createdAt)}
        </div>
        <h1 className="h1">{r.title}</h1>
        <div className="row wrap">
          <Chip tone={r.overdue ? 'danger' : statusTone[r.status]}>
            {r.overdue ? 'Срок вышел' : statusLabel[r.status]}
          </Chip>
          <Deadline r={r} />
        </div>
      </div>

      {r.liability && <LiabilityBlock l={r.liability} />}
      {r.isAuthor && r.kind !== 'emergency' && <ShareBlock r={r} />}

      {r.executor && (
        <Card className="card__section card--accent">
          <div className="eyebrow eyebrow--accent">Исполнитель</div>
          <div className="row" style={{ gap: 12 }}>
            <div className="avatar">{initials(r.executor.nameShort)}</div>
            <div className="stack">
              <div style={{ fontSize: 16, fontWeight: 600 }}>{r.executor.nameShort}</div>
              {r.executor.slot && <div className="muted num">Придёт {r.executor.slot}</div>}
            </div>
          </div>
          {r.executor.phone && (
            <a className="btn btn--primary" href={`tel:${r.executor.phone.replace(/[^\d+]/g, '')}`}>
              Позвонить
            </a>
          )}
          <div className="hint">
            Служебный номер. Виден только вам и только пока заявка открыта.
          </div>
        </Card>
      )}

      {r.status === 'done' && r.isAuthor && (
        <Card className="card__section card--accent">
          <div className="eyebrow eyebrow--accent">Проверьте результат</div>
          <div className="row">
            <Button
              className="grow"
              loading={confirm.isPending}
              onClick={() => confirm.mutate(true)}
            >
              Всё исправили
            </Button>
            <Button
              variant="secondary"
              loading={confirm.isPending}
              onClick={() => confirm.mutate(false)}
            >
              Вернуть
            </Button>
          </div>
        </Card>
      )}

      <Card className="card__section">
        <div className="eyebrow">Ход заявки</div>
        <Timeline steps={buildTimeline(r.status, r.events)} />
      </Card>

      <Card>
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="thumb">
            {r.photos[0]?.url ? <img src={r.photos[0].url} alt="" /> : <IconCamera size={26} />}
          </div>
          <div className="stack" style={{ fontSize: 14 }}>
            <div>
              <span className="muted">Где:</span> {r.locationText}
            </div>
            {r.measurements[0] && (
              <div>
                <span className="muted">Замер:</span> {r.measurements[0].value} °C
              </div>
            )}
            {r.description && <div>{r.description}</div>}
          </div>
        </div>
      </Card>

      {(r.claim.available || r.gji.available) && (
        <Card className="card__section">
          <div className="eyebrow">Документы</div>
          {r.claim.available && (
            <a
              className="btn btn--secondary"
              href={r.claim.url ?? '#'}
              target="_blank"
              rel="noreferrer"
            >
              Заявление на перерасчёт (PDF)
            </a>
          )}
          {r.gji.available ? (
            <Button variant="secondary">Жалоба в ГЖИ</Button>
          ) : r.gji.afterAt ? (
            <div className="hint">
              Жалоба в ГЖИ станет доступна после истечения срока ответа УК —{' '}
              {fmtDateTime(r.gji.afterAt)}.
            </div>
          ) : null}
        </Card>
      )}
    </main>
  );
}
