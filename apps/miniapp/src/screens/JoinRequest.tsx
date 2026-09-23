import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useJoinRequest, useMe, useRequest } from '../api/hooks';
import type { MeasurementPlace } from '../api/types';
import { fmtDateTime, plural } from '../lib/format';
import { Button, Card, ErrorView, Field, Loading, PageHeader, Tile } from '../ui';
import { IconUsers } from '../ui/icons';

export function JoinRequest() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const q = useRequest(id);
  const join = useJoinRequest(id);
  const [apartment, setApartment] = useState('');
  const [temp, setTemp] = useState('');
  const [place, setPlace] = useState<MeasurementPlace>('room');
  const [error, setError] = useState<string | null>(null);

  if (q.isPending || me.isPending) return <Loading />;
  if (q.isError) return <ErrorView message={q.error.message} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const label = apartment || me.data?.house?.apartmentLabel || '';
  const needsTemp = r.kind === 'utility_quality';

  const submit = async () => {
    if (!label) return setError('Укажите номер квартиры');
    if (needsTemp && temp !== '' && Number.isNaN(Number(temp)))
      return setError('Температура — число');
    try {
      await join.mutateAsync({
        apartmentLabel: label.startsWith('кв') ? label : `кв. ${label}`,
        measurements:
          needsTemp && temp !== ''
            ? [
                {
                  value: Number(temp),
                  unit: 'celsius',
                  measuredAt: new Date().toISOString(),
                  place,
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
          className="input"
          inputMode="numeric"
          placeholder={me.data?.house?.apartmentLabel ?? '48'}
          value={apartment}
          onChange={(e) => setApartment(e.target.value)}
        />
      </Field>
      {needsTemp && (
        <Card className="card__section">
          <div className="eyebrow">Ваш замер, если есть</div>
          <div className="input--unit">
            <input
              className="input"
              inputMode="decimal"
              placeholder="16"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              aria-label="Температура"
            />
            <span>°C</span>
          </div>
          <div className="tiles tiles--2">
            <Tile short on={place === 'room'} onClick={() => setPlace('room')}>
              Комната
            </Tile>
            <Tile short on={place === 'corner_room'} onClick={() => setPlace('corner_room')}>
              Угловая
            </Tile>
          </div>
        </Card>
      )}
      {error && <div className="field__error">{error}</div>}
      <div className="cta">
        <Button size="lg" loading={join.isPending} onClick={() => void submit()}>
          У меня тоже
        </Button>
      </div>
    </main>
  );
}
