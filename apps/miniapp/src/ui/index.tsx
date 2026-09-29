import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { ApiError } from '../api/client';
import type { Provenance } from '../api/types';
import { IconCheck, IconPhone } from './icons';

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

export function CallButton({
  phone,
  tone = 'primary',
  label,
}: {
  phone: string;
  tone?: 'primary' | 'outline' | 'danger';
  label: string;
}) {
  return (
    <a
      className={cx(
        'call',
        tone === 'outline' && 'call--outline',
        tone === 'danger' && 'call--danger',
      )}
      href={`tel:${phone.replace(/[^\d+]/g, '')}`}
      aria-label={label}
    >
      <IconPhone />
    </a>
  );
}

export type ChipTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral';

export function Chip({
  tone = 'neutral',
  xs,
  children,
}: {
  tone?: ChipTone;
  xs?: boolean;
  children: ReactNode;
}) {
  return <span className={cx('chip', `chip--${tone}`, xs && 'chip--xs')}>{children}</span>;
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

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  large,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  large?: boolean;
}) {
  return (
    <div className="stack">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1 className={cx('h1', large && 'h1--lg')}>{title}</h1>
      {subtitle && <div className="muted">{subtitle}</div>}
    </div>
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
}: {
  value: ReactNode;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="stat">
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
        <div className="field__error">{error}</div>
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

export function Loading({ text }: { text?: string }) {
  return (
    <div className="center" role="status">
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
  children,
}: {
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="center">
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
