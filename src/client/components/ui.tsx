import { useEffect, useRef, type ReactNode } from 'react';
import type { Category } from '../../shared/types';
import { useData } from '../data';
import { useSettings } from '../settings';

export function Logo({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect className="mk-bg" width="32" height="32" rx="8" />
      <polyline className="mk-ln" points="7,21 12,15.5 16,18.5" />
      <polyline className="mk-dot" points="16,18.5 21,13.5" />
      <circle className="mk-acc" cx="24.5" cy="10" r="2.4" />
    </svg>
  );
}

const ICONS = {
  overview: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  transactions: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  planning: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  forecast: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  categories: 'M3 12V3h9l9 9-9 9-9-9zM7.5 7.5h.01',
  import: 'M12 15V3M7 8l5-5 5 5M4 15v5h16v-5',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 013-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 01-3 3H3',
  close: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  download: 'M12 3v12M7 10l5 5 5-5M4 19h16'
} as const;

export function Icon({ name, label, size }: { name: keyof typeof ICONS; label?: string; size?: number }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" style={size ? { width: size, height: size } : undefined}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Dot({ color, opacity = 1, size }: { color: string; opacity?: number; size?: number }) {
  return <span className="dot" style={{ background: color, opacity, ...(size ? { width: size, height: size } : {}) }} />;
}

export function Amount({ cents, className = '' }: { cents: number; className?: string }) {
  const { money } = useSettings();
  return <span className={`amt ${cents > 0 ? 'pos' : ''} ${className}`}>{money(cents, { signed: true })}</span>;
}

/** Colored chip naming a payee's category ("Main › Sub"), or a warning chip when there is none. */
export function CategoryChip({ categoryId }: { categoryId: number | null | undefined }) {
  const { state } = useData();
  const { t } = useSettings();
  const c = state.categories.find((x) => x.id === categoryId);
  if (!c) return <span className="chip warn"><Dot color="#ADB5BD" />{t('uncategorized')}</span>;
  return <span className="chip"><Dot color={c.color} />{categoryLabel(state.categories, c)}</span>;
}

export function categoryLabel(categories: Category[], c: Category): string {
  const parent = c.parentId ? categories.find((x) => x.id === c.parentId) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Grouped select of all categories; main categories are selectable too. */
export function CategorySelect({ value, onChange, allowNone = true, noneLabel, kind }: {
  value: number | null; onChange: (id: number | null) => void; allowNone?: boolean; noneLabel?: string; kind?: 'expense' | 'income';
}) {
  const { state } = useData();
  const { t } = useSettings();
  const tops = state.categories.filter((c) => !c.parentId && (!kind || c.kind === kind));
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowNone && <option value="">{noneLabel ?? t('uncategorized')}</option>}
      {tops.map((top) => (
        <optgroup key={top.id} label={top.name}>
          <option value={top.id}>{top.name}</option>
          {state.categories.filter((c) => c.parentId === top.id).map((c) => (
            <option key={c.id} value={c.id}>{top.name} › {c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export function Modal({ title, open, onClose, children, footer }: {
  title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      {open && (
        <>
          <div className="modal-head">
            <h2 className="h2">{title}</h2>
            <button type="button" className="iconbtn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

/** Text input for euro amounts in either locale ("1.234,56" or "1,234.56"); reports cents. */
export function parseAmountInput(s: string): number | null {
  // A separator followed by one or two digits at the end is the decimal mark; others group thousands.
  const m = s.replace(/[€\s+-]/g, '').match(/^([\d.,]*?)(?:[.,](\d{1,2}))?$/);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = m[1].replace(/[.,]/g, '') || '0';
  return Number(whole) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function formatAmountInput(cents: number, lang: 'de' | 'en'): string {
  const s = (Math.abs(cents) / 100).toFixed(2);
  return lang === 'de' ? s.replace('.', ',') : s;
}
