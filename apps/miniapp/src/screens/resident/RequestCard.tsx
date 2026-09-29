import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useConfirmRequest, useOpenDocument, useRequest } from '../../api/hooks';
import type { Liability, RequestDetail } from '../../api/types';
import { ensureWebApp } from '../../bridge';
import { useBackButton } from '../../bridge/back';
import { demoClock, useDemoOffset } from '../../clock';
import { fmtDate, fmtDateTime, fmtDuration, plural } from '../../lib/format';
import {
  buildTimeline,
  closedStatuses,
  rejectionReason,
  statusLabel,
  statusTone,
} from '../../lib/request';
import {
  Button,
  ButtonLink,
  Card,
  Chip,
  ErrorView,
  formatRub,
  Loading,
  Money,
  PageHeader,
  ProvenanceChip,
  Stat,
  Timeline,
} from '../../ui';
import { IconClock, IconCopy, IconShare, IconUser, IconUsers } from '../../ui/icons';

type Photo = RequestDetail['photos'][number];

/** Просрочка выполненной заявки известна только серверу (он смотрит на endedAt) —
 * локальный отсчёт от dueAt ведём лишь пока работа не сделана. */
export const isOverdueNow = (r: RequestDetail, now: Date): boolean =>
  r.status === 'done' || closedStatuses.includes(r.status)
    ? r.overdue
    : r.overdue || new Date(r.dueAt).getTime() < now.getTime();

function Deadline({ r }: { r: RequestDetail }) {
  useDemoOffset();
  const left = new Date(r.dueAt).getTime() - demoClock.now().getTime();
  const overdue = isOverdueNow(r, demoClock.now());
  if (closedStatuses.includes(r.status)) {
    return overdue ? (
      <span className="status-line status-line--muted">закрыта с просрочкой</span>
    ) : null;
  }
  if (r.status === 'done') {
    return (
      <span className="status-line status-line--muted">
        {r.endedAt ? `выполнена ${fmtDateTime(r.endedAt)}` : 'выполнена'}
        {overdue && ', с просрочкой'}
      </span>
    );
  }
  return (
    <span className={`status-line ${overdue ? 'status-line--danger' : 'status-line--muted'}`}>
      <IconClock size={14} />
      {overdue
        ? `Срок вышел ${fmtDuration(left)} назад`
        : `Срок — до ${fmtDate(r.dueAt)}, осталось ${fmtDuration(left)}`}
    </span>
  );
}

/**
 * Лента миниатюр. По нажатию фото открывается на весь экран, повторное нажатие закрывает:
 * на миниатюре 72 px не разглядеть, что именно сделано.
 */
function PhotoStrip({ photos }: { photos: Photo[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const withUrl = photos.filter((p) => p.url);
  if (withUrl.length === 0) return null;
  return (
    <>
      <div className="photos">
        {withUrl.map((p) => (
          <button
            key={p.key}
            type="button"
            className="thumb thumb--button"
            onClick={() => setOpen(p.url)}
            aria-label="Открыть фото"
          >
            <img src={p.url} alt="" width={76} height={76} loading="lazy" />
          </button>
        ))}
      </div>
      {open && (
        <button
          type="button"
          className="lightbox"
          onClick={() => setOpen(null)}
          aria-label="Закрыть фото"
        >
          <img src={open} alt="" />
        </button>
      )}
    </>
  );
}

function ShareBlock({ r }: { r: RequestDetail }) {
  const [copied, setCopied] = useState(false);
  const total = r.joinersCount + 1;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(r.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const share = async () => {
    const wa = ensureWebApp();
    // Соседям — суть и подъезд, но не квартира автора
    const where = r.locationText.replace(/,?\s*кв\.\s*\S+/i, '');
    const text = `${r.title} — ${where}. Если у вас так же, присоединяйтесь: ${r.shareUrl}`;
    if (wa.shareMaxContent) {
      try {
        await wa.shareMaxContent({ text });
        return;
      } catch {}
    }
    await copy();
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
          {copied ? 'Скопировано' : <IconCopy size={18} />}
        </Button>
      </div>
      <div className="hint">
        Соседи откроют ссылку в MAX и присоединятся одной кнопкой. УК получит одну заявку с
        масштабом вместо десятков дублей.
      </div>
    </Card>
  );
}

function LiabilityBlock({ l, closed }: { l: Liability; closed: boolean }) {
  const hours = Math.round(l.hours * 10) / 10;
  const counting = l.thresholdReachedAt !== null && l.apartmentKopecks > 0;
  return (
    <Card className="card__section">
      <div className="row row--between">
        <div className="eyebrow">Перерасчёт</div>
        <ProvenanceChip value={l.steps.some((s) => s.provenance === 'model') ? 'model' : 'calc'} />
      </div>
      {counting ? (
        <>
          <div>
            <Money kopecks={l.apartmentKopecks} />
            <div className="muted">
              вам положено за {hours.toLocaleString('ru-RU')}{' '}
              {plural(Math.round(hours), 'час', 'часа', 'часов')} нарушения
            </div>
          </div>
          <div className="stats">
            <Stat small value={formatRub(l.houseKopecks)} label="по всем квартирам заявки" />
            <Stat
              small
              value={`+${formatRub(l.perHourHouseKopecks)} / ч`}
              label={closed ? 'набегало, пока не устранили' : 'растёт, пока не устранят'}
            />
          </div>
        </>
      ) : (
        <div className="banner banner--accent">
          {l.thresholdReachedAt === null
            ? 'Допустимый перерыв ещё не превышен — перерасчёт начнётся после порога по ПП 354.'
            : 'Сумма появится, как только нарушение продлится дольше допустимого.'}
        </div>
      )}
      <details className="calc">
        <summary>Как посчитано</summary>
        <div className="sum">
          {l.steps.map((s) => (
            <div className="sum-row" key={s.label}>
              <span className="sum-row__label">
                <span>{s.label}</span>
                {s.ref && (
                  <span className="hint">
                    {s.ref.act}, {s.ref.point}
                  </span>
                )}
                <ProvenanceChip value={s.provenance} />
              </span>
              <span className="sum-row__value">
                {s.value.toLocaleString('ru-RU')} {s.unit}
              </span>
            </div>
          ))}
          {counting && (
            <div className="sum-row sum-row--total">
              <span className="sum-row__label">Итого вам</span>
              <span className="sum-row__value">{formatRub(l.apartmentKopecks)}</span>
            </div>
          )}
        </div>
        <div className="hint">
          Правила версии {l.rulesVersion}. Сумма по дому — оценка: площади соседей неизвестны.
        </div>
      </details>
    </Card>
  );
}

export function RequestCard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const q = useRequest(id);
  const confirm = useConfirmRequest(id ?? '');
  const doc = useOpenDocument();
  useDemoOffset();
  useBackButton(() => navigate('/requests'));

  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorView error={q.error} message={q.error.message} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const closed = closedStatuses.includes(r.status);
  const overdue = isOverdueNow(r, demoClock.now()) && !closed && r.status !== 'done';
  const total = r.joinersCount + 1;
  const reason = r.status === 'rejected' ? rejectionReason(r.events) : null;
  // Фото без stage (старые ответы, мок) считаем фото жителя
  const residentPhotos = r.photos.filter((p) => p.stage !== 'after');
  const resultPhotos = r.photos.filter((p) => p.stage === 'after');

  return (
    <main className="page">
      <PageHeader
        hero
        backTo="/requests"
        eyebrow={`Заявка № ${r.number} от ${fmtDateTime(r.createdAt)}`}
        title={r.title}
      >
        <div className="row wrap">
          <Chip tone={overdue ? 'danger' : statusTone[r.status]} solid={overdue}>
            {overdue ? 'Срок вышел' : statusLabel[r.status]}
          </Chip>
          {r.kind !== 'emergency' && (
            <Chip tone="accent">
              <IconUsers size={14} /> {total} {plural(total, 'квартира', 'квартиры', 'квартир')}
            </Chip>
          )}
        </div>
        <Deadline r={r} />
      </PageHeader>

      {r.status === 'rejected' && (
        <div className="banner banner--danger">
          <div>
            <strong>Управляющая организация отклонила заявку.</strong>
            {reason ? ` Причина: ${reason}` : ''}
          </div>
        </div>
      )}

      {confirm.isSuccess && confirm.variables === true && r.status === 'confirmed' && (
        <div className="banner banner--accent">
          Спасибо, заявка закрыта.
          {r.claim.available && ' Заявление на перерасчёт можно скачать ниже.'}
        </div>
      )}

      {r.canJoin && !r.isAuthor && (
        <ButtonLink to={`/join/${r.id}`} size="lg" stretched>
          <IconUsers size={18} />У меня тоже
        </ButtonLink>
      )}

      {r.liability && <LiabilityBlock l={r.liability} closed={closed} />}
      {r.isAuthor && r.kind !== 'emergency' && !closed && <ShareBlock r={r} />}

      {r.executor && (
        <Card className="card__section">
          <div className="eyebrow">Исполнитель</div>
          <div className="row" style={{ gap: 12 }}>
            <span className="icon-sq" aria-hidden="true">
              <IconUser size={20} />
            </span>
            <div className="stack">
              <div style={{ fontSize: 16, fontWeight: 600 }}>{r.executor.nameShort}</div>
              {r.executor.slot && <div className="muted num">Придёт {r.executor.slot}</div>}
            </div>
          </div>
          {/* Вторичная: главное действие на экране — позвать соседей */}
          {r.executor.phone && (
            <a
              className="btn btn--secondary"
              href={`tel:${r.executor.phone.replace(/[^\d+]/g, '')}`}
            >
              Позвонить
            </a>
          )}
          <div className="hint">
            Служебный номер. Виден только вам и только пока заявка открыта.
          </div>
        </Card>
      )}

      {/* Фото исполнителя — перед подтверждением: житель сначала видит работу, потом решает */}
      {resultPhotos.length > 0 && (
        <Card className="card__section">
          <div className="eyebrow">Результат работы</div>
          <PhotoStrip photos={resultPhotos} />
          <div className="hint">
            {resultPhotos.length} {plural(resultPhotos.length, 'фото', 'фото', 'фото')} от
            исполнителя. Нажмите, чтобы открыть крупно.
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

      {r.status !== 'rejected' && (
        <Card className="card__section">
          <div className="eyebrow">Ход заявки</div>
          <Timeline steps={buildTimeline(r.status, r.events)} />
        </Card>
      )}

      <Card className="card__section">
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
        <PhotoStrip photos={residentPhotos} />
      </Card>

      {r.isAuthor && (r.claim.available || r.gji.available || r.gji.afterAt) && (
        <Card className="card__section">
          <div className="eyebrow">Документы</div>
          {r.claim.available && (
            <Button
              size="lg"
              className="btn--split"
              loading={doc.isPending && doc.variables?.filename.startsWith('zayavlenie')}
              onClick={() =>
                doc.mutate({
                  requestId: r.id,
                  kind: 'claim',
                  filename: `zayavlenie-${r.number}.pdf`,
                  signedUrl: r.claim.url,
                })
              }
            >
              {r.liability && r.liability.apartmentKopecks > 0 && (
                <span className="btn__value">{formatRub(r.liability.apartmentKopecks)}</span>
              )}
              Скачать заявление
            </Button>
          )}
          {r.gji.available ? (
            <Button
              variant="secondary"
              loading={doc.isPending && doc.variables?.filename.startsWith('gji')}
              onClick={() =>
                doc.mutate({
                  requestId: r.id,
                  kind: 'gji',
                  filename: `gji-${r.number}.pdf`,
                })
              }
            >
              Обращение в жилищную инспекцию (PDF)
            </Button>
          ) : r.gji.afterAt ? (
            <div className="hint">
              Обращение в ГЖИ станет доступно после истечения срока ответа УК —{' '}
              {fmtDateTime(r.gji.afterAt)}: раньше его вернут как преждевременное.
            </div>
          ) : null}
          {doc.isError && (
            <div className="field__error" role="alert">
              {doc.error.message}
            </div>
          )}
          <div className="hint">
            Документы собираются из данных заявки: период нарушения, замеры, расчёт со ссылками на
            нормы и список присоединившихся квартир.
          </div>
        </Card>
      )}
    </main>
  );
}
