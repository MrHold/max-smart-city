import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useCategories, useCreateRequest, useMe, useUploadPhoto } from '../../api/hooks';
import type { Category, LocationScope, MeasurementPlace, NewRequestInput } from '../../api/types';
import { ensureWebApp } from '../../bridge';
import { useBackButton } from '../../bridge/back';
import { demoClock } from '../../clock';
import { fmtDateTime, parseTemp, toLocalInputValue } from '../../lib/format';
import { Button, Card, ErrorView, Field, Loading, StepProgress, Tile } from '../../ui';
import {
  IconArrowLeft,
  IconBroom,
  IconBulb,
  IconCamera,
  IconChevron,
  IconClose,
  IconDrop,
  IconElevator,
  IconFire,
  IconThermo,
  IconWarning,
  IconWrench,
} from '../../ui/icons';

const icons: Record<string, typeof IconWrench> = {
  heating: IconThermo,
  heating_off: IconFire,
  hot_water: IconDrop,
  hot_water_off: IconDrop,
  cold_water_off: IconDrop,
  yard_lighting: IconBulb,
  entrance_light: IconBulb,
  yard_cleaning: IconBroom,
  entrance_cleaning: IconBroom,
  elevator: IconElevator,
};

const groupTitle = {
  utility: 'Отопление и вода',
  yard: 'Двор',
  entrance: 'Подъезд',
  other: 'Дом и квартира',
};

function groupOf(c: Category): keyof typeof groupTitle {
  if (c.kind === 'utility_quality' || c.kind === 'utility_interruption') return 'utility';
  return c.zone === 'yard' || c.zone === 'entrance' ? c.zone : 'other';
}

const scopes: Array<{ value: LocationScope; label: string }> = [
  { value: 'apartment', label: 'В квартире' },
  { value: 'entrance', label: 'В подъезде' },
  { value: 'floor', label: 'На этаже' },
  { value: 'yard', label: 'Во дворе' },
];

const places: Array<{ value: MeasurementPlace; label: string }> = [
  { value: 'room', label: 'Комната' },
  { value: 'corner_room', label: 'Угловая комната' },
  { value: 'tap', label: 'Из крана' },
];

export function NewRequest() {
  const navigate = useNavigate();
  const me = useMe();
  const houseId = me.data?.house?.id;
  const cats = useCategories(houseId);
  const create = useCreateRequest();
  const upload = useUploadPhoto();

  const [step, setStep] = useState(1);
  const [category, setCategory] = useState<Category | null>(null);
  const [scope, setScope] = useState<LocationScope>('apartment');
  const [entrance, setEntrance] = useState('');
  const [floor, setFloor] = useState('');
  const [note, setNote] = useState('');
  const [startedAt, setStartedAt] = useState(() =>
    toLocalInputValue(new Date(demoClock.now().getTime() - 3_600_000)),
  );
  const [temp, setTemp] = useState('');
  const [place, setPlace] = useState<MeasurementPlace>('room');
  const [planned, setPlanned] = useState<boolean | null>(null);
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Array<{ key: string; preview: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const goBack = () => {
    setError(null);
    if (step > 1) setStep(step - 1);
    else navigate('/', { replace: true });
  };
  useBackButton(goBack);

  // Со второго шага в форме уже есть введённое: пусть MAX переспросит перед закрытием
  useEffect(() => {
    const wa = ensureWebApp();
    if (step >= 2) wa.enableClosingConfirmation?.();
    else wa.disableClosingConfirmation?.();
    return () => wa.disableClosingConfirmation?.();
  }, [step]);

  const groups = useMemo(() => {
    const g = new Map<keyof typeof groupTitle, Category[]>();
    for (const c of cats.data ?? []) {
      if (c.kind === 'emergency') continue;
      const k = groupOf(c);
      g.set(k, [...(g.get(k) ?? []), c]);
    }
    return g;
  }, [cats.data]);

  if (me.isPending || cats.isPending) return <Loading />;
  if (me.isError)
    return (
      <ErrorView error={me.error} message={me.error.message} onRetry={() => void me.refetch()} />
    );
  if (!me.data.house) return <Navigate to="/bind" replace />;
  if (cats.isError)
    return (
      <ErrorView
        error={cats.error}
        message={cats.error.message}
        onRetry={() => void cats.refetch()}
      />
    );

  const isQuality = category?.kind === 'utility_quality';
  const isInterruption = category?.kind === 'utility_interruption';
  const needsTemp = isQuality || (isInterruption && category?.service === 'heating');

  const tempValue = parseTemp(temp);
  // Календарь не даёт выбрать будущий день, но будущий час сегодня — даёт, а «Очистить»
  // оставляет поле пустым: проверяем сразу, чтобы ошибка была видна у самого поля.
  const startedMs = new Date(startedAt).getTime();
  const startedError = Number.isNaN(startedMs)
    ? 'Укажите, когда началось'
    : startedMs > demoClock.now().getTime()
      ? 'Начало не может быть в будущем'
      : null;

  const validateStep2 = (): string | null => {
    if ((scope === 'entrance' || scope === 'floor') && !entrance) return 'Укажите номер подъезда';
    if (scope === 'floor' && !floor) return 'Укажите этаж';
    if (needsTemp && tempValue === null) return 'Нужен замер температуры';
    if (needsTemp && tempValue !== null && (tempValue < -30 || tempValue > 45))
      return 'Температура от −30 до +45 °C';
    if (isInterruption && planned === null) return 'Ответьте, было ли объявление об отключении';
    return null;
  };

  const onPhoto = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    try {
      const res = await upload.mutateAsync(file);
      setPhotos((p) => [...p, { key: res.key, preview }]);
    } catch (e) {
      URL.revokeObjectURL(preview);
      setError((e as Error).message);
    }
  };

  const removePhoto = (key: string) => {
    setPhotos((list) => {
      const gone = list.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((p) => p.key !== key);
    });
  };

  const submit = async () => {
    if (!category) return;
    const input: NewRequestInput = {
      category: category.code,
      location: {
        scope,
        ...(entrance ? { entrance: Number(entrance) } : {}),
        ...(floor ? { floor: Number(floor) } : {}),
        ...(note ? { note } : {}),
      },
      description,
      startedAt: new Date(startedAt).toISOString(),
      measurements:
        needsTemp && tempValue !== null
          ? [{ value: tempValue, unit: 'celsius', measuredAt: new Date().toISOString(), place }]
          : [],
      plannedNotice: isInterruption ? planned : null,
      photoKeys: photos.map((p) => p.key),
    };
    try {
      const r = await create.mutateAsync(input);
      navigate(`/requests/${r.id}`, { replace: true });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main className="page page--no-tabbar page--with-cta">
      <div className="stack-8">
        <button type="button" className="back-link" onClick={goBack}>
          <IconArrowLeft size={18} />
          Назад
        </button>
        <StepProgress step={step} total={3} />
        <h1 className="h1">
          {step === 1 ? 'Что случилось?' : step === 2 ? 'Где и когда?' : 'Проверьте заявку'}
        </h1>
        {step > 1 && category && (
          <div className="muted">
            {category.title} ·{' '}
            <button type="button" className="link-btn" onClick={() => setStep(1)}>
              изменить
            </button>
          </div>
        )}
      </div>

      {step === 1 && (
        <>
          <Link to="/contacts" className="banner banner--danger">
            <IconWarning size={22} />
            <div className="grow" style={{ fontSize: 14 }}>
              <strong>Авария?</strong> Протечка, нет света, запах газа — звоните в аварийную службу
            </div>
            <IconChevron size={18} />
          </Link>
          {[...groups.entries()].map(([key, list]) => (
            <div className="stack-8" key={key}>
              <div className="eyebrow">{groupTitle[key]}</div>
              <div className="tiles">
                {list.map((c) => {
                  const Icon = icons[c.code] ?? IconWrench;
                  return (
                    <Tile
                      key={c.code}
                      on={category?.code === c.code}
                      icon={<Icon size={26} />}
                      onClick={() => setCategory(c)}
                    >
                      {c.title}
                    </Tile>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}

      {step === 2 && category && (
        <>
          <div className="stack-8">
            <div className="eyebrow">Где</div>
            <div className="tiles tiles--2">
              {scopes.map((s) => (
                <Tile key={s.value} short on={scope === s.value} onClick={() => setScope(s.value)}>
                  {s.label}
                </Tile>
              ))}
            </div>
            {scope !== 'yard' && scope !== 'apartment' && (
              <div className="row">
                <Field label="Подъезд" htmlFor="entrance">
                  <input
                    id="entrance"
                    name="entrance"
                    className="input"
                    autoComplete="off"
                    inputMode="numeric"
                    value={entrance}
                    onChange={(e) => setEntrance(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  />
                </Field>
                {scope === 'floor' && (
                  <Field label="Этаж" htmlFor="floor">
                    <input
                      id="floor"
                      name="floor"
                      className="input"
                      autoComplete="off"
                      inputMode="numeric"
                      value={floor}
                      onChange={(e) => setFloor(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    />
                  </Field>
                )}
              </div>
            )}
            {scope === 'yard' && (
              <Field label="Уточнение" htmlFor="note" hint="Например: у второго подъезда">
                <input
                  id="note"
                  name="note"
                  className="input"
                  autoComplete="off"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                />
              </Field>
            )}
          </div>

          <Field label="Когда началось" htmlFor="startedAt" error={startedError ?? undefined}>
            <input
              id="startedAt"
              name="startedAt"
              className="input"
              type="datetime-local"
              value={startedAt}
              max={toLocalInputValue(demoClock.now())}
              onChange={(e) => setStartedAt(e.target.value)}
            />
          </Field>

          {needsTemp && (
            <Card className="card__section">
              <div className="eyebrow eyebrow--accent">Замер температуры</div>
              <div className="hint">
                {isQuality
                  ? 'Норма: +18 °C в комнате, +20 °C в угловой. По замеру считаем перерасчёт.'
                  : 'При перерыве отопления допустимая длительность зависит от температуры в комнате.'}
              </div>
              <Field label="Температура" htmlFor="temp">
                <div className="input--unit">
                  <input
                    id="temp"
                    name="temperature"
                    className="input"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Например, 15…"
                    value={temp}
                    onChange={(e) => setTemp(e.target.value)}
                  />
                  <span>°C</span>
                </div>
              </Field>
              <div className="tiles tiles--2">
                {places
                  .filter((p) =>
                    category.service === 'heating' ? p.value !== 'tap' : p.value === 'tap',
                  )
                  .map((p) => (
                    <Tile
                      key={p.value}
                      short
                      on={place === p.value}
                      onClick={() => setPlace(p.value)}
                    >
                      {p.label}
                    </Tile>
                  ))}
              </div>
            </Card>
          )}

          {isInterruption && (
            <Card className="card__section">
              <div className="eyebrow">Было объявление об отключении?</div>
              <div className="tiles tiles--2">
                <Tile short on={planned === true} onClick={() => setPlanned(true)}>
                  Да, плановое
                </Tile>
                <Tile short on={planned === false} onClick={() => setPlanned(false)}>
                  Нет
                </Tile>
              </div>
              <div className="hint">
                Плановое отключение в пределах нормы — не нарушение, перерасчёт не начисляется.
              </div>
            </Card>
          )}

          <div className="stack-8">
            <div className="eyebrow">Фото</div>
            <div className="photos">
              {photos.map((p, i) => (
                <div className="thumb thumb--removable" key={p.key}>
                  <img src={p.preview} alt="Фото проблемы" width={76} height={76} />
                  <button
                    type="button"
                    className="thumb__remove"
                    aria-label={`Удалить фото ${i + 1}`}
                    onClick={() => removePhoto(p.key)}
                  >
                    <IconClose size={14} />
                  </button>
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
                    onChange={(e) => {
                      void onPhoto(e.target.files);
                      // иначе тот же файл после удаления не выбрать повторно
                      e.target.value = '';
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <Field label="Описание" htmlFor="description">
            <textarea
              id="description"
              name="description"
              className="textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              placeholder="Что видите, с какого момента…"
            />
          </Field>
        </>
      )}

      {step === 3 && category && (
        <Card className="card__section">
          <Row label="Что" value={category.title} />
          <Row
            label="Где"
            value={[
              scopes.find((s) => s.value === scope)?.label,
              entrance && `подъезд ${entrance}`,
              floor && `этаж ${floor}`,
              note,
            ]
              .filter(Boolean)
              .join(', ')}
          />
          <Row label="С какого момента" value={fmtDateTime(new Date(startedAt).toISOString())} />
          {needsTemp && (
            <Row
              label="Замер"
              value={`${temp} °C, ${places.find((p) => p.value === place)?.label.toLowerCase()}`}
            />
          )}
          {isInterruption && <Row label="Объявление" value={planned ? 'было' : 'не было'} />}
          {photos.length > 0 && <Row label="Фото" value={String(photos.length)} />}
          {description && <Row label="Описание" value={description} />}
          <div className="hint">
            После отправки бот предложит поделиться заявкой в чате дома — соседи смогут
            присоединиться.
          </div>
        </Card>
      )}

      {error && (
        <div className="field__error" role="alert">
          {error}
        </div>
      )}

      <div className="cta">
        <Button variant="secondary" onClick={goBack} style={{ flexGrow: 0 }}>
          Назад
        </Button>
        {step === 1 && (
          <Button size="lg" disabled={!category} onClick={() => setStep(2)}>
            Далее: где это?
          </Button>
        )}
        {step === 2 && (
          <Button
            size="lg"
            onClick={() => {
              const err = validateStep2();
              setError(err);
              if (!err && !startedError) setStep(3);
            }}
          >
            Далее: проверить
          </Button>
        )}
        {step === 3 && (
          <Button size="lg" loading={create.isPending} onClick={() => void submit()}>
            Отправить в УК
          </Button>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv">
      <span className="kv__label">{label}</span>
      <span className="kv__value">{value}</span>
    </div>
  );
}
