import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useJoinRequest, useMe, useRequest } from '../api/hooks';
import type { MeasurementPlace } from '../api/types';
import { useBackButton } from '../bridge/back';
import { demoClock } from '../clock';
import { fmtDateTime, parseTemp, plural } from '../lib/format';
import { Button, Card, ErrorView, Field, Loading, PageHeader, Tile } from '../ui';
import { IconUsers } from '../ui/icons';

export function JoinRequest() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const hasHouse = Boolean(me.data?.house);
  const q = useRequest(id, hasHouse);
  const join = useJoinRequest(id);
  useBackButton(() => navigate('/', { replace: true }));
  const [apartment, setApartment] = useState('');
  const [temp, setTemp] = useState('');
  const [place, setPlace] = useState<MeasurementPlace>('room');
  const [error, setError] = useState<string | null>(null);

  if (me.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );
  // Сосед без дома сначала привязывает его и возвращается сюда
  if (!hasHouse) return <Navigate to="/bind" replace state={{ next: `/join/${id}` }} />;
  if (q.isPending) return <Loading />;
  if (q.isError)
    return <ErrorView error={q.error} message={q.error.message} onRetry={() => void q.refetch()} />;
  const r = q.data;
  // Автору и уже присоединившемуся здесь делать нечего — им нужна карточка
  if (r.isAuthor || !r.canJoin) return <Navigate to={`/requests/${id}`} replace />;
  const label = apartment || me.data?.apartmentLabel || '';
  const needsTemp = r.kind === 'utility_quality';
  const isHotWater = r.service === 'hot_water';
  const [tMin, tMax] = isHotWater ? [0, 100] : [-30, 45];

  const submit = async () => {
    if (!label) return setError('Укажите номер квартиры');
    if (apartment && (!/^\d{1,4}$/.test(apartment) || Number(apartment) < 1)) {
      return setError('Номер квартиры — от 1 до 9999');
    }
    const t = parseTemp(temp);
    if (needsTemp && temp !== '' && (t === null || t < tMin || t > tMax))
      return setError(`Температура — число от ${tMin < 0 ? `−${-tMin}` : tMin} до +${tMax}`);
    try {
      await join.mutateAsync({
        apartmentLabel: label.startsWith('кв') ? label : `кв. ${label}`,
        measurements:
          needsTemp && temp !== ''
            ? [
                {
                  value: t as number,
                  unit: 'celsius',
                  measuredAt: demoClock.now().toISOString(),
                  place: isHotWater ? 'tap' : place,
                },
              ]
            : [],
      });
      navigate(`/requests/${id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const total = r.joinersCount + 1;

  return (
    <main className="page page--no-tabbar page--with-cta">
      <PageHeader
        backTo="/"
        eyebrow="Заявка соседа"
        title={r.title}
        subtitle={`${r.locationText} · от ${fmtDateTime(r.createdAt)}`}
      />
      <Card className="card__section card--accent">
        <div className="row" style={{ gap: 10 }}>
          <IconUsers size={22} style={{ color: 'var(--accent)' }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Уже {total} {plural(total, 'квартира', 'квартиры', 'квартир')}
            </div>
            <div className="muted">
              Одна заявка от дома вместо десятков одинаковых — УК видит масштаб
            </div>
          </div>
        </div>
      </Card>
      {r.description && (
        <Card>
          <div style={{ fontSize: 14 }}>{r.description}</div>
        </Card>
      )}
      <Field
        label="Ваша квартира"
        htmlFor="apt"
        hint="Номер квартиры увидит только УК, соседи — нет"
      >
        <input
          id="apt"
          name="apartment"
          className="input"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          placeholder={me.data?.apartmentLabel ?? '48'}
          value={apartment}
          onChange={(e) => setApartment(e.target.value.replace(/\D/g, ''))}
        />
      </Field>
      {needsTemp && (
        <Card className="card__section">
          <div className="eyebrow">Ваш замер, если есть</div>
          <div className="input--unit">
            <input
              name="temperature"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Например, 16…"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              aria-label="Температура"
            />
            <span>°C</span>
          </div>
          {!isHotWater && (
            <div className="tiles tiles--2">
              <Tile short on={place === 'room'} onClick={() => setPlace('room')}>
                Комната
              </Tile>
              <Tile short on={place === 'corner_room'} onClick={() => setPlace('corner_room')}>
                Угловая
              </Tile>
            </div>
          )}
        </Card>
      )}
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
      <div className="cta">
        <Button size="lg" loading={join.isPending} onClick={() => void submit()}>
          У меня тоже
        </Button>
      </div>
    </main>
  );
}
