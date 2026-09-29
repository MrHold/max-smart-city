import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  type DispatcherAction,
  useDispatcherAction,
  useExecutors,
  useUploadPhoto,
} from '../../api/hooks';
import type { BulkResult, ClusterCard } from '../../api/types';
import { demoClock, useDemoOffset } from '../../clock';
import { fmtDateTime, fmtDuration, plural, toLocalInputValue } from '../../lib/format';
import { statusLabel, statusTone } from '../../lib/request';
import { Button, Card, Chip, cx, Empty, formatRub, Loading, Money, Stat } from '../../ui';
import { IconArrowLeft, IconCamera, IconClock } from '../../ui/icons';
import { InviteLink } from './InviteLink';

type Act = ReturnType<typeof useDispatcherAction>;

function ResultNote({ r }: { r: BulkResult }) {
  return (
    <div className={cx('banner', r.skipped.length ? 'banner--warn' : 'banner--accent')}>
      <div>
        {plural(r.updated, 'Обновлена', 'Обновлены', 'Обновлено')} {r.updated}{' '}
        {plural(r.updated, 'заявка', 'заявки', 'заявок')}
        {r.skipped.length > 0 && `, пропущено ${r.skipped.length}`}
      </div>
      {r.skipped.map((s) => (
        <div className="hint" key={s.requestId}>
          {s.reason}
        </div>
      ))}
    </div>
  );
}

function RejectForm({ ids, act }: { ids: string[]; act: Act }) {
  const [reason, setReason] = useState('');
  return (
    <div className="stack-8">
      <textarea
        className="textarea"
        rows={3}
        maxLength={500}
        aria-label="Причина отклонения"
        name="reason"
        placeholder="Причина: жители увидят её в заявке…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        variant="danger"
        disabled={reason.trim().length === 0}
        loading={act.isPending}
        onClick={() =>
          act.mutate({ action: 'reject', body: { requestIds: ids, reason: reason.trim() } })
        }
      >
        Отклонить с причиной
      </Button>
    </div>
  );
}

function defaultPlanned(): string {
  const d = demoClock.now();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalInputValue(d);
}

function AssignForm({ c, act, onCancel }: { c: ClusterCard; act: Act; onCancel?: () => void }) {
  const executors = useExecutors();
  const [executorId, setExecutorId] = useState<string | null>(null);
  const [planned, setPlanned] = useState(defaultPlanned);
  const [rejecting, setRejecting] = useState(false);

  if (executors.isPending) return <Loading />;
  if (executors.isError)
    return (
      <div className="field__error" role="alert">
        {executors.error.message}
      </div>
    );

  const fits = (categories: string[]) => categories.includes(c.category);
  const list = [...executors.data].sort(
    (a, b) => Number(fits(b.categories)) - Number(fits(a.categories)),
  );
  const chosen = list.find((e) => e.id === executorId);

  return (
    <Card className="card__section">
      <div className="eyebrow">Назначить исполнителя</div>
      {list.length === 0 && <div className="muted">У организации пока нет исполнителей</div>}
      {list.map((e) => {
        const on = e.id === executorId;
        const fit = fits(e.categories);
        return (
          <label
            key={e.id}
            className={cx('exec-option', on && 'exec-option--on', !fit && 'exec-option--off')}
          >
            <input
              type="radio"
              name="executor"
              checked={on}
              disabled={!fit}
              onChange={() => setExecutorId(e.id)}
            />
            <span className="grow stack" style={{ gap: 4 }}>
              <span className="row row--between">
                <strong>{e.nameShort}</strong>
                {fit ? (
                  <Chip xs tone="accent">
                    по профилю
                  </Chip>
                ) : (
                  <span className="muted" style={{ fontSize: 12 }}>
                    не по профилю
                  </span>
                )}
              </span>
              {e.inBot ? (
                <span className="status-line status-line--ok">
                  <span className="dot" />
                  получает наряды в MAX
                </span>
              ) : (
                <span className="row wrap" style={{ gap: 8 }}>
                  <span className="status-line status-line--muted">нет в MAX</span>
                  <InviteLink executor={e} />
                </span>
              )}
            </span>
          </label>
        );
      })}
      <label className="field">
        <span className="field__label">Когда придёт</span>
        <input
          type="datetime-local"
          className="input"
          value={planned}
          onChange={(e) => setPlanned(e.target.value)}
        />
      </label>
      {chosen && !chosen.inBot && (
        <div className="banner banner--warn">
          Наряд в бот не придёт: {chosen.nameShort} ещё не открыл приглашение. Заявка всё равно
          будет назначена.
        </div>
      )}
      <Button
        size="lg"
        disabled={!executorId}
        loading={act.isPending}
        onClick={() =>
          executorId &&
          act.mutate({
            action: 'assign',
            body: {
              requestIds: c.requestIds,
              executorId,
              plannedAt: planned ? new Date(planned).toISOString() : undefined,
            },
          })
        }
      >
        Назначить и уведомить
      </Button>
      <div className="hint">
        Исполнителю уйдёт наряд, жителям — имя и время визита. Личный телефон не передаётся.
      </div>
      {c.status === 'accepted' &&
        (rejecting ? (
          <RejectForm ids={c.requestIds} act={act} />
        ) : (
          <button type="button" className="link-btn" onClick={() => setRejecting(true)}>
            Отклонить с причиной
          </button>
        ))}
      {onCancel && (
        <button type="button" className="link-btn" onClick={onCancel}>
          Оставить прежнего исполнителя
        </button>
      )}
    </Card>
  );
}

function ExecutorInfo({ c }: { c: ClusterCard }) {
  if (!c.executor) return null;
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{c.executor.nameShort}</div>
      {c.executor.plannedAt && (
        <div className="muted num">Визит {fmtDateTime(c.executor.plannedAt)}</div>
      )}
    </div>
  );
}

/** Назначен, но ещё не приступил: закрыть можно только начатую работу. */
function StartForm({ c, act }: { c: ClusterCard; act: Act }) {
  const who = c.executor?.nameShort ?? 'исполнитель';
  const [reassign, setReassign] = useState(false);
  if (reassign) return <AssignForm c={c} act={act} onCancel={() => setReassign(false)} />;
  return (
    <Card className="card__section">
      <div className="eyebrow">Исполнитель</div>
      <ExecutorInfo c={c} />
      <div className="banner banner--accent">
        Ждём, когда {who} примет наряд в боте. Отметить выполненной можно, когда работа начата.
      </div>
      <Button
        size="lg"
        variant="secondary"
        loading={act.isPending}
        onClick={() => act.mutate({ action: 'start', body: { requestIds: c.requestIds } })}
      >
        Исполнитель приступил
      </Button>
      <div className="hint">
        Если договорились по телефону или исполнитель не пользуется ботом. Жители получат
        уведомление, что работа началась.
      </div>
      <button type="button" className="link-btn" onClick={() => setReassign(true)}>
        Назначить другого исполнителя
      </button>
    </Card>
  );
}

function CompleteForm({ c, act }: { c: ClusterCard; act: Act }) {
  const upload = useUploadPhoto();
  const [photos, setPhotos] = useState<Array<{ key: string; url: string }>>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const onPhoto = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || photos.length >= 5) return;
    setPhotoError(null);
    try {
      const r = await upload.mutateAsync(f);
      setPhotos((p) => [...p, r]);
    } catch (e) {
      setPhotoError((e as Error).message);
    }
  };
  return (
    <Card className="card__section">
      <div className="eyebrow">Исполнитель</div>
      <ExecutorInfo c={c} />
      <div className="stack-8">
        <div className="field__label">Фото после работ</div>
        <div className="photos">
          {photos.map((p) => (
            <div className="thumb" key={p.key}>
              {p.url ? <img src={p.url} alt="" width={76} height={76} /> : <IconCamera size={22} />}
            </div>
          ))}
          {photos.length < 5 && (
            <label className="photo-add">
              <IconCamera size={22} />
              {upload.isPending ? '…' : 'Добавить'}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={upload.isPending}
                onChange={(e) => {
                  void onPhoto(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      </div>
      {photoError && (
        <div className="field__error" role="alert">
          {photoError}
        </div>
      )}
      {photos.length === 0 && (
        <div className="hint">Без фото жителю нечего проверять: добавьте хотя бы одно.</div>
      )}
      <Button
        size="lg"
        loading={act.isPending}
        onClick={() =>
          act.mutate({
            action: 'complete',
            body: { requestIds: c.requestIds, photoKeys: photos.map((p) => p.key) },
          })
        }
      >
        Отметить выполненной
      </Button>
      <div className="hint">
        Жители получат фото и кнопку «Всё исправили». Без ответа заявка закроется через трое суток.
      </div>
    </Card>
  );
}

function Actions({ c, act }: { c: ClusterCard; act: Act }) {
  const [rejecting, setRejecting] = useState(false);
  const n = c.requestIds.length;
  const mutate = (a: DispatcherAction) => act.mutate(a);

  switch (c.status) {
    case 'new':
      return (
        <Card className="card__section">
          <div className="eyebrow">Что делать</div>
          <div className="row">
            <Button
              className="grow"
              loading={act.isPending}
              onClick={() => mutate({ action: 'accept', body: { requestIds: c.requestIds } })}
            >
              Принять в работу
            </Button>
            <Button variant="secondary" onClick={() => setRejecting((v) => !v)}>
              Отклонить
            </Button>
          </div>
          {rejecting && <RejectForm ids={c.requestIds} act={act} />}
          <div className="hint">
            Одно действие на{' '}
            {n === 1 ? 'заявку' : `все ${n} ${plural(n, 'заявку', 'заявки', 'заявок')}`} этой
            причины: жители получат уведомление.
          </div>
        </Card>
      );
    case 'accepted':
    case 'reopened':
      return <AssignForm c={c} act={act} />;
    case 'assigned':
      return <StartForm c={c} act={act} />;
    case 'in_progress':
      return <CompleteForm c={c} act={act} />;
    case 'done':
      return (
        <div className="banner banner--accent">
          Выполнена. Ждём подтверждения жителей: без ответа заявка закроется сама через трое суток.
        </div>
      );
    default:
      return null;
  }
}

export function ClusterPanel({
  cluster,
  loading,
  onClose,
}: {
  cluster: ClusterCard | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  useDemoOffset();
  const act = useDispatcherAction();
  const location = useLocation();

  if (loading) return <Loading />;

  if (!cluster) {
    return (
      <div className="stack cab__panel">
        {act.data ? (
          <ResultNote r={act.data} />
        ) : (
          <Empty title="Заявки больше нет во входящих" text="Её закрыли или отклонили" />
        )}
        <Button variant="secondary" onClick={onClose}>
          К списку
        </Button>
      </div>
    );
  }

  const c = cluster;
  const left = new Date(c.dueAt).getTime() - demoClock.now().getTime();
  const overdue = c.status !== 'done' && (c.overdue || left < 0);
  const n = c.requestIds.length;

  return (
    <div className="stack cab__panel">
      <button type="button" className="back-link" onClick={onClose}>
        <IconArrowLeft size={18} />
        Все заявки
      </button>
      <div className="stack-8">
        <div className="muted">{c.houseAddress}</div>
        <h2 className="h2">{c.title}</h2>
        <div className="row wrap">
          <Chip tone={overdue ? 'danger' : statusTone[c.status]}>
            {overdue ? 'Срок вышел' : statusLabel[c.status]}
          </Chip>
          <span className="muted num">
            {c.apartments} {plural(c.apartments, 'квартира', 'квартиры', 'квартир')} · {n}{' '}
            {plural(n, 'заявка', 'заявки', 'заявок')}
          </span>
        </div>
      </div>

      <Card className="card__section">
        <div className="row row--between">
          <div className="eyebrow">Цена простоя</div>
          <span
            className={cx('status-line', overdue ? 'status-line--danger' : 'status-line--muted')}
          >
            <IconClock size={14} />
            {overdue ? `Срок вышел ${fmtDuration(left)} назад` : `до ${fmtDateTime(c.dueAt)}`}
          </span>
        </div>
        {c.kopecks > 0 ? (
          <>
            <Money kopecks={c.kopecks} />
            <div className="stats">
              <Stat
                small
                value={`+${formatRub(c.perHourKopecks)} / ч`}
                label="растёт, пока не устранят"
              />
              <Stat small value={fmtDateTime(c.startedAt)} label="начало проблемы" />
            </div>
          </>
        ) : (
          <div className="muted">Перерасчёт пока не начислен · с {fmtDateTime(c.startedAt)}</div>
        )}
      </Card>

      {act.data && <ResultNote r={act.data} />}
      {act.isError && (
        <div className="field__error" role="alert">
          {act.error.message}
        </div>
      )}
      <Actions c={c} act={act} />

      <Card className="card__section">
        <div className="eyebrow">Заявки жителей</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {c.requestIds.map((id, i) => (
            <Link
              key={id}
              to={`/requests/${id}`}
              state={{ back: location.pathname }}
              className="btn btn--secondary btn--sm"
            >
              Заявка {i + 1}
            </Link>
          ))}
        </div>
        <div className="hint">Описание, замер и фото жителя — в карточке каждой заявки.</div>
      </Card>
    </div>
  );
}
