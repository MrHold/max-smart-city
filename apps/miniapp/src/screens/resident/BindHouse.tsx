import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBindHouse, useHouseSearch } from '../../api/hooks';
import type { HouseSearchItem } from '../../api/types';
import { Button, Card, Field, PageHeader, ProvenanceChip } from '../../ui';
import { IconSearch } from '../../ui/icons';

export function BindHouse() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [house, setHouse] = useState<HouseSearchItem | null>(null);
  const [apartment, setApartment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const search = useHouseSearch(q);
  const bind = useBindHouse();

  const submit = async () => {
    if (!house) return setError('Выберите дом');
    if (!apartment) return setError('Укажите квартиру');
    try {
      await bind.mutateAsync({ houseId: house.id, apartmentLabel: `кв. ${apartment}` });
      navigate('/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="page page--no-tabbar page--with-cta">
      <PageHeader
        eyebrow="Первый вход"
        title="Где вы живёте?"
        subtitle="Дом привязывается один раз, дальше всё сразу"
      />
      <Field label="Адрес дома" htmlFor="q">
        <div className="input--unit">
          <IconSearch size={18} style={{ color: 'var(--ink-3)' }} />
          <input
            id="q"
            className="input"
            placeholder="Улица и номер дома"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHouse(null);
            }}
            autoComplete="off"
          />
        </div>
      </Field>
      {search.data && !house && (
        <Card pad={false} className="list">
          {search.data.length === 0 ? (
            <div className="list-item muted">Ничего не нашли — попробуйте иначе</div>
          ) : (
            search.data.map((h) => (
              <button
                type="button"
                key={h.id}
                className="list-item list-item--link"
                style={{ width: '100%', background: 'none', border: 0, textAlign: 'left' }}
                onClick={() => setHouse(h)}
              >
                <div className="grow list-item__title" style={{ fontWeight: 500 }}>
                  {h.address}
                </div>
                {h.dataKind === 'model' && <ProvenanceChip value="model" />}
              </button>
            ))
          )}
        </Card>
      )}
      {house && (
        <>
          <Card className="card__section">
            <div className="row row--between">
              <div style={{ fontWeight: 600 }}>{house.address}</div>
              <Button size="xs" variant="secondary" onClick={() => setHouse(null)}>
                Изменить
              </Button>
            </div>
          </Card>
          <Field
            label="Квартира"
            htmlFor="apt"
            hint="В MVP адрес заявляется вами; в пилоте подтверждает УК по лицевому счёту"
          >
            <input
              id="apt"
              className="input"
              inputMode="numeric"
              value={apartment}
              onChange={(e) => setApartment(e.target.value)}
            />
          </Field>
        </>
      )}
      {error && <div className="field__error">{error}</div>}
      <div className="cta">
        <Button size="lg" loading={bind.isPending} disabled={!house} onClick={() => void submit()}>
          Это мой дом
        </Button>
      </div>
    </main>
  );
}
