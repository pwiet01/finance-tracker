import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Category, Transaction } from '../../shared/types';
import { api, useData } from '../data';
import { useSettings } from '../settings';
import { CategoryChip, Dot, categoryLabel } from './ui';

const PAGE = 40;

/** Categories matching a search: name starts beat label contains; main categories sort first. */
export function searchCategories(categories: Category[], query: string): Category[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: [Category, number][] = [];
  for (const c of categories) {
    const name = c.name.toLowerCase(), label = categoryLabel(categories, c).toLowerCase();
    const score = name.startsWith(q) ? 0 : name.split(/[\s&,-]+/).some((w) => w.startsWith(q)) ? 1 : label.includes(q) ? 2 : -1;
    if (score >= 0) scored.push([c, score]);
  }
  return scored.sort((a, b) => a[1] - b[1] || Number(!!a[0].parentId) - Number(!!b[0].parentId)).map(([c]) => c);
}

type Row =
  | { kind: 'payee'; payeeId: number; count: number; sum: number; sample: string }
  | { kind: 'tx'; payeeId: number; tx: Transaction };

/** Uncategorised bookings of a mixed payee, one row each, newest first. */
const txRows = (txs: Transaction[], payeeId: number): Row[] =>
  txs.filter((tx) => tx.payeeId === payeeId && !tx.categoryId).map((tx) => ({ kind: 'tx', payeeId, tx }));

/**
 * Keyboard-driven list of payees without category, most frequent first, followed by the
 * single bookings of mixed payees. The list is fixed when it opens, so rows stay in place
 * while categories are assigned.
 */
export function PayeeTriage({ transactionIds, onDone }: { transactionIds?: number[]; onDone?: () => void }) {
  const { state, lk, mutate } = useData();
  const { t, money, pct, date } = useSettings();
  const scope = useMemo(() => {
    const wanted = transactionIds ? new Set(transactionIds) : null;
    return state.transactions.filter((tx) => !wanted || wanted.has(tx.id));
  }, [state.transactions, transactionIds]);

  const [rows, setRows] = useState<Row[]>(() => {
    const uncategorized = new Set(state.payees.filter((p) => !p.categoryId && !p.mixed).map((p) => p.id));
    const stats = new Map<number, { count: number; sum: number; sample: string }>();
    for (const tx of scope) {
      if (!uncategorized.has(tx.payeeId) || tx.categoryId) continue;
      const s = stats.get(tx.payeeId) ?? { count: 0, sum: 0, sample: tx.purpose };
      s.count++;
      s.sum += tx.amount;
      stats.set(tx.payeeId, s);
    }
    const payeeRows: Row[] = [...stats.entries()]
      .sort(([, a], [, b]) => b.count - a.count || Math.abs(b.sum) - Math.abs(a.sum))
      .map(([payeeId, s]) => ({ kind: 'payee', payeeId, ...s }));
    return [...payeeRows, ...state.payees.filter((p) => p.mixed).flatMap((p) => txRows(scope, p.id))];
  });
  const [limit, setLimit] = useState(PAGE);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const share = useMemo(() => {
    let all = 0, done = 0;
    for (const tx of scope) {
      all += Math.abs(tx.amount);
      if (lk.categoryOf(tx)) done += Math.abs(tx.amount);
    }
    return all ? done / all : 1;
  }, [scope, lk]);

  const focusRow = (i: number) => {
    if (i >= limit && i < rows.length) setLimit(limit + PAGE);
    requestAnimationFrame(() => inputs.current[i]?.focus());
  };
  const assign = (i: number, categoryId: number) => {
    focusRow(i + 1);
    const r = rows[i];
    void mutate(() => r.kind === 'tx'
      ? api('PATCH', '/transactions', { ids: [r.tx.id], categoryId })
      : api('PATCH', `/payees/${r.payeeId}`, { categoryId }));
  };
  /** Replaces a payee row with rows for its single bookings. */
  const markMixed = (i: number) => {
    const { payeeId } = rows[i];
    setRows([...rows.slice(0, i), ...txRows(scope, payeeId), ...rows.slice(i + 1)]);
    focusRow(i);
    void mutate(() => api('PATCH', `/payees/${payeeId}`, { mixed: true }));
  };

  return (
    <section className="card stack">
      <div className="between">
        <div><h2 className="h2">{t('triageTitle')}</h2><div className="small muted">{t('triageIntro')}</div></div>
        <span className="small muted">{t('categorizedShare', { p: pct(share) })}</span>
      </div>
      <div className="prog"><span style={{ width: `${share * 100}%`, background: 'var(--accent)' }} /></div>
      {rows.length === 0 ? <div className="empty">{t('triageDone')}</div> : (
        <div className="triage">
          {rows.slice(0, limit).map((r, i) => {
            const payee = state.payees.find((p) => p.id === r.payeeId);
            if (!payee) return null;
            const tx = r.kind === 'tx' ? state.transactions.find((x) => x.id === r.tx.id) ?? r.tx : null;
            const current = tx ? tx.categoryId : payee.categoryId;
            return (
              <div key={tx ? `t${tx.id}` : `p${r.payeeId}`} className={`trow ${current ? 'done' : ''}`}>
                <div className="grow">
                  <div className="strong ellipsis">{payee.name}</div>
                  <div className="small muted ellipsis">
                    {tx ? `${date(tx.date)} · ${money(tx.amount, { signed: true })}${tx.purpose ? ` · ${tx.purpose}` : ''}`
                      : r.kind === 'payee' && `${t('txN', { n: r.count })} · ${money(r.sum, { signed: true })}${r.sample ? ` · ${r.sample}` : ''}`}
                  </div>
                </div>
                {!tx && !current && (
                  <button type="button" className="btn sm" title={t('markMixedHint', { name: payee.name })} onClick={() => markMixed(i)}>{t('markMixed')}</button>
                )}
                <CategoryCombo
                  inputRef={(el) => { inputs.current[i] = el; }}
                  current={current}
                  onPick={(id) => assign(i, id)}
                  onMove={(d) => focusRow(i + d)}
                />
              </div>
            );
          })}
          {rows.length > limit && <div className="empty"><button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>{t('showMore')}</button></div>}
        </div>
      )}
      {onDone && <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn primary" onClick={onDone}>{t('continue')}</button></div>}
    </section>
  );
}

/** Type-ahead category picker; Enter picks the highlighted match. */
function CategoryCombo({ current, onPick, onMove, inputRef }: {
  current: number | null; onPick: (id: number) => void; onMove: (delta: number) => void; inputRef: (el: HTMLInputElement | null) => void;
}) {
  const { state } = useData();
  const { t } = useSettings();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => searchCategories(state.categories, q).slice(0, 8), [state.categories, q]);
  const showList = open && q.trim() !== '';

  const pick = (c: Category) => { setQ(''); setHi(0); onPick(c.id); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      if (showList && matches.length) setHi((hi + d + matches.length) % matches.length);
      else onMove(d);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showList && matches[hi]) pick(matches[hi]);
      else if (!q) onMove(1);
    } else if (e.key === 'Escape') {
      setQ('');
    }
  };

  return (
    <div className="combo">
      {current && <CategoryChip categoryId={current} />}
      <div className="combo-box">
        <input value={q} placeholder={t('catSearchPh')} ref={inputRef} aria-autocomplete="list" aria-expanded={showList}
          onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
        {showList && (
          <div className="combo-list" role="listbox">
            {matches.length === 0 ? <div className="combo-item muted">{t('noCatMatch')}</div> : matches.map((c, i) => (
              <div key={c.id} role="option" aria-selected={i === hi} className={`combo-item ${i === hi ? 'on' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(c); }} onMouseEnter={() => setHi(i)}>
                <Dot color={c.color} />{categoryLabel(state.categories, c)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
