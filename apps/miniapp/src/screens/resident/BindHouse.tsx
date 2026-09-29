import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBindHouse, useHouseSearch } from '../../api/hooks';
import type { HouseSearchItem } from '../../api/types';
import { Button, Card, Field, PageHeader, ProvenanceChip, Spot } from '../../ui';
import { IconHome, IconSearch } from '../../ui/icons';

export function BindHouse() {
  const navigate = useNavigate();
  const next = (useLocation().state as { next?: string } | null)?.next;
  const [q, setQ] = useState('');
  const [house, setHouse] = useState<HouseSearchItem | null>(null);
  const [apartment, setApartment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const search = useHouseSearch(q);
  const bind = useBindHouse();

  const submit = async () => {
    if (!house) return setError('Выберите дом');
    if (!/^\d{1,4}$/.test(apartment) || Number(apartment) < 1) {
      return setError('Номер квартиры — от 1 до 9999');
    }
    try {
      await bind.mutateAsync({ houseId: house.id, apartmentLabel: `кв. ${apartment}` });
      navigate(next ?? '/', { replace: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="page page--no-tabbar page--with-cta">
      <Spot icon={<IconHome size={34} />} />
      <PageHeader
        center
        eyebrow="Первый вход"
        title="Где вы живёте?"
        subtitle="Дом привязывается один раз, дальше всё сразу"
      />
      <Field label="Адрес дома" htmlFor="q">
        <div className="input-search">
          <IconSearch size={18} />
          <input
            id="q"
            name="address"
            type="search"
            enterKeyHint="search"
            className="input"
            placeholder="Например, Садовая, 12…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setHouse(null);
            }}
            autoComplete="off"
            spellCheck={false}
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
              name="apartment"
              className="input"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={apartment}
              onChange={(e) => setApartment(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        </>
      )}
      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}
      <div className="cta">
        <Button size="lg" loading={bind.isPending} disabled={!house} onClick={() => void submit()}>
          Это мой дом
        </Button>
      </div>
    </main>
  );
}
