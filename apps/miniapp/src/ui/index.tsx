import { type ButtonHTMLAttributes, type ReactNode, useState } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { Provenance } from '../api/types';
import { IconArrowLeft, IconCheck, IconChevron, IconPhone, IconWarning } from './icons';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm' | 'xs';

function btnClass(variant: Variant, size: Size, stretched?: boolean, extra?: string) {
  return cx(
    'btn',
    `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    stretched && 'btn--stretched',
    extra,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  stretched,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  stretched?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      className={btnClass(variant, size, stretched, className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
      ) : (
        children
      )}
    </button>
  );
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  stretched,
  className,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; stretched?: boolean }) {
  return <Link className={btnClass(variant, size, stretched, className)} {...rest} />;
}

/**
 * Можно ли позвонить с этого устройства. Смотрим не на клиент MAX, а на указатель:
 * палец (pointer: coarse) — телефон или планшет, там tel: открывает звонилку, в том
 * числе в веб-версии MAX в мобильном браузере. Мышь — компьютер: там tel: вызывает
 * системный вопрос «чем открыть», поэтому номер вместо звонка копируем.
 */
export function canDial(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

/** Скопировать номер; true — получилось. */
async function copyPhone(phone: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(phone);
    return true;
  } catch {
    // Старые WebView без Clipboard API
    const ta = document.createElement('textarea');
    ta.value = phone;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Отметка «скопировано» на полторы секунды. */
function useCopied(): [boolean, (phone: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (phone: string) => {
    void copyPhone(phone).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return [copied, copy];
}

/** Круглая кнопка-трубка: на телефоне звонит, на компьютере копирует номер. */
export function CallButton({
  phone,
  tone = 'primary',
  label,
}: {
  phone: string;
  tone?: 'primary' | 'outline' | 'danger';
  label: string;
}) {
  const [copied, copy] = useCopied();
  const className = cx(
    'call',
    tone === 'outline' && 'call--outline',
    tone === 'danger' && 'call--danger',
  );
  if (canDial()) {
    return (
      <a className={className} href={telHref(phone)} aria-label={label}>
        <IconPhone />
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      onClick={() => copy(phone)}
      title={copied ? 'Номер скопирован' : `${phone} — нажмите, чтобы скопировать`}
      aria-label={`${label}: ${phone}. Скопировать номер`}
    >
      {copied ? <IconCheck /> : <IconPhone />}
    </button>
  );
}

/** Большая кнопка звонка (исполнитель, диспетчер УК): на компьютере — номер и копирование. */
export function PhoneAction({ phone, variant = 'primary' }: { phone: string; variant?: Variant }) {
  const [copied, copy] = useCopied();
  if (canDial()) {
    return (
      <a className={btnClass(variant, 'md', undefined, undefined)} href={telHref(phone)}>
        Позвонить
      </a>
    );
  }
  return (
    <button
      type="button"
      className={btnClass('secondary', 'md', undefined, undefined)}
      onClick={() => copy(phone)}
    >
      {copied ? 'Номер скопирован' : `${phone} · скопировать`}
    </button>
  );
}

export type ChipTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral';

export function Chip({
  tone = 'neutral',
  xs,
  solid,
  children,
}: {
  tone?: ChipTone;
  xs?: boolean;
  /** Залитая плашка с белым текстом — для главного статуса: срок вышел, сумма к возврату */
  solid?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cx('chip', `chip--${tone}`, xs && 'chip--xs', solid && 'chip--solid')}>
      {children}
    </span>
  );
}

const provenanceLabel: Record<Provenance, { text: string; tone: ChipTone }> = {
  fact: { text: 'по норме', tone: 'ok' },
  calc: { text: 'расчёт', tone: 'accent' },
  model: { text: 'модельные данные', tone: 'warn' },
};

export function ProvenanceChip({ value }: { value: Provenance }) {
  const p = provenanceLabel[value];
  return (
    <Chip tone={p.tone} xs>
      {p.text}
    </Chip>
  );
}

export function Card({
  className,
  pad = true,
  children,
  to,
}: {
  className?: string;
  pad?: boolean;
  children: ReactNode;
  to?: string;
}) {
  const cls = cx('card', pad && 'card--pad', className);
  return to ? (
    <Link to={to} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function SectionHeader({
  title,
  action,
  to,
}: {
  title: string;
  action?: string;
  to?: string;
}) {
  return (
    <div className="row row--between row--baseline">
      <h2 className="h2">{title}</h2>
      {action && to && (
        <Link to={to} style={{ fontSize: 14, fontWeight: 500 }}>
          {action}
        </Link>
      )}
    </div>
  );
}

/**
 * Шапка экрана. `hero` — синяя шапка во всю ширину колонки со скруглённым краем листа снизу:
 * для разделов и карточки заявки. Без неё — обычный заголовок на фоне.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  large,
  hero,
  center,
  backTo,
  onBack,
  leading,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  large?: boolean;
  hero?: boolean;
  center?: boolean;
  backTo?: string;
  onBack?: () => void;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const back = backTo ? (
    <Link to={backTo} className="head__back" aria-label="Назад">
      <IconArrowLeft size={20} />
    </Link>
  ) : onBack ? (
    <button type="button" className="head__back" onClick={onBack} aria-label="Назад">
      <IconArrowLeft size={20} />
    </button>
  ) : null;
  const h1 = <h1 className={cx('h1', large && 'h1--lg')}>{title}</h1>;
  return (
    <header className={cx('head', hero && 'head--hero', center && 'head--center')}>
      {back && <div className="head__bar">{back}</div>}
      <div className="head__main">
        {leading}
        <div className="head__titles">
          {eyebrow && <div className="head__eyebrow">{eyebrow}</div>}
          {/* Действие на одной строке с заголовком, а не над ним */}
          {actions ? (
            <div className="head__title-row">
              {h1}
              <div className="head__actions">{actions}</div>
            </div>
          ) : (
            h1
          )}
          {subtitle && <div className="head__sub">{subtitle}</div>}
        </div>
      </div>
      {children}
    </header>
  );
}

/** Иллюстрация-пятно для пустых, успешных и ошибочных состояний */
export function Spot({
  icon,
  tone = 'brand',
}: {
  icon: ReactNode;
  tone?: 'brand' | 'ok' | 'danger';
}) {
  return (
    <div className={cx('spot', tone !== 'brand' && `spot--${tone}`)} aria-hidden="true">
      <span className="spot__blob" />
      <span className="spot__dot spot__dot--a" />
      <span className="spot__dot spot__dot--b" />
      <span className="spot__dot spot__dot--c" />
      <span className="spot__core">{icon}</span>
    </div>
  );
}

/** Строка-переход: иконка, заголовок с подписью, значение справа и шеврон */
export function RowLink({
  to,
  icon,
  tone,
  title,
  sub,
  value,
}: {
  to: string;
  icon?: ReactNode;
  tone?: 'ok' | 'warn' | 'danger' | 'neutral';
  title: string;
  sub?: ReactNode;
  value?: ReactNode;
}) {
  return (
    <Link to={to} className="row-link">
      {icon && (
        <span className={cx('icon-sq', tone && `icon-sq--${tone}`)} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="row-link__text">
        <span className="row-link__title">{title}</span>
        {sub && <span className="row-link__sub">{sub}</span>}
      </span>
      {value && <span className="row-link__value">{value}</span>}
      <IconChevron size={18} className="chev" aria-hidden="true" />
    </Link>
  );
}

export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="stack-8">
      <div className="muted" style={{ fontWeight: 500 }}>
        Шаг {step} из {total}
      </div>
      <div className="progress" style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}>
        {Array.from({ length: total }, (_, i) => ({ id: `bar${i + 1}`, on: i < step })).map((b) => (
          <div key={b.id} className={cx('progress__bar', b.on && 'progress__bar--on')} />
        ))}
      </div>
    </div>
  );
}

export function Tile({
  on,
  icon,
  short,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; icon?: ReactNode; short?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      className={cx('tile', on && 'tile--on', short && 'tile--short')}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function Stat({
  value,
  label,
  small,
  tone,
}: {
  value: ReactNode;
  label: string;
  small?: boolean;
  tone?: 'danger' | 'warn';
}) {
  return (
    <div className={cx('stat', tone && `stat--${tone}`)}>
      <div className={cx('stat__value', small && 'stat__value--sm')}>{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <div className="field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="hint">{hint}</div>
      ) : null}
    </div>
  );
}

export type TimelineStep = { label: string; at?: string; state: 'done' | 'current' | 'todo' };

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="timeline">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div className="tl" key={s.label}>
            <div className="tl__rail">
              <div
                className={cx(
                  'tl__dot',
                  s.state === 'done' && 'tl__dot--done',
                  s.state === 'current' && 'tl__dot--current',
                )}
              >
                {s.state === 'done' && <IconCheck size={11} />}
              </div>
              {!last && <div className={cx('tl__line', s.state === 'done' && 'tl__line--done')} />}
            </div>
            <div
              className={cx(
                'tl__body',
                s.state === 'todo' && 'tl__body--todo',
                s.state === 'current' && 'tl__body--current',
              )}
            >
              {s.state === 'todo' ? s.label : <strong>{s.label}</strong>}
              {s.at && <time> · {s.at}</time>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Loading({ text, compact }: { text?: string; compact?: boolean }) {
  return (
    <div className={cx('center', compact && 'center--compact')} role="status" aria-live="polite">
      <div className="spinner" />
      {text && <div className="muted">{text}</div>}
    </div>
  );
}

export function ErrorView({
  message,
  onRetry,
  error,
}: {
  message: string;
  onRetry?: () => void;
  error?: unknown;
}) {
  // Протухшая initData не лечится повтором: MAX выдаст новую только при повторном открытии
  const expired = error instanceof ApiError && error.status === 401;
  return (
    <div className="center" role="alert">
      <Spot tone="danger" icon={<IconWarning size={34} />} />
      <div className="h2" style={{ color: 'var(--ink)' }}>
        {expired ? 'Откройте приложение заново' : 'Не получилось загрузить'}
      </div>
      <div className="muted">
        {expired ? 'Сессия MAX истекла. Закройте мини-приложение и откройте его снова.' : message}
      </div>
      {onRetry && !expired && (
        <Button variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </div>
  );
}

export function Empty({
  title,
  text,
  icon,
  children,
}: {
  title: string;
  text?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="center">
      <Spot icon={icon ?? <IconCheck size={34} />} />
      <div className="h2" style={{ color: 'var(--ink)' }}>
        {title}
      </div>
      {text && <div className="muted">{text}</div>}
      {children}
    </div>
  );
}

export function Money({ kopecks, small }: { kopecks: number; small?: boolean }) {
  return <span className={cx('money', small && 'money--sm')}>{formatRub(kopecks)}</span>;
}

export function formatRub(kopecks: number): string {
  const rub = Math.round(kopecks / 100);
  return `${rub.toLocaleString('ru-RU')} ₽`;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div
      className="segmented"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx('segmented__btn', o.value === value && 'segmented__btn--on')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
