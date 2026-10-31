import { useMemo, useState } from 'react';
import { addDays, dayDiff, monthKey } from '../../shared/dates';
import { historyCandidates } from '../../shared/matching';
import { occurrences, subtree } from '../../shared/plans';
import { resolveRule, ruleMatches } from '../../shared/rules';
import type { MatchType, Plan, Transaction } from '../../shared/types';
import { Amount, CategoryChip, CategorySelect, Icon, formatAmountInput, parseAmountInput } from '../components/ui';
import { api, useData } from '../data';
import { navigate } from '../router';
import { useSettings } from '../settings';

const PAGE = 150;

/** The occurrence of a plan a booking settles: the nearest due date, else the booking date. */
export function periodFor(plan: Plan, date: string): string {
  if (plan.type !== 'recurring') return plan.startDate;
  const dates = occurrences(plan, addDays(date, -20), addDays(date, 20));
  return dates.reduce<string | null>((best, d) => (!best || Math.abs(dayDiff(date, d)) < Math.abs(dayDiff(date, best)) ? d : best), null) ?? date;
}

export function TransactionsPage({ query }: { query: URLSearchParams }) {
  const { state, lk } = useData();
  const { t, monthLabel, date } = useSettings();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [limit, setLimit] = useState(PAGE);
  const cat = query.get('cat') ?? '';
  const month = query.get('month') ?? '';
  const selId = Number(query.get('tx')) || null;
  const matched = useMemo(() => new Set(state.matches.map((m) => m.transactionId)), [state.matches]);

  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(query);
    if (value) p.set(key, value); else p.delete(key);
    navigate(`/transactions${p.toString() ? `?${p}` : ''}`);
  };

  const months = useMemo(() => [...new Set(state.transactions.map((tx) => monthKey(tx.date)))], [state.transactions]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const ids = cat && cat !== 'none' ? subtree(state.categories, Number(cat)) : null;
    return state.transactions.filter((tx) => {
      const c = lk.categoryOf(tx);
      if (cat === 'none' && c) return false;
      if (ids && (!c || !ids.has(c.id))) return false;
      if (month && monthKey(tx.date) !== month) return false;
      if (needle && !`${lk.payeeName(tx.payeeId)} ${tx.rawPayee} ${tx.purpose}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [state, lk, q, cat, month]);
  const selected = state.transactions.find((tx) => tx.id === selId);

  return (
    <>
      <div className="head">
        <div><h1 className="h1">{t('transactions')}</h1><div className="muted">{t('txCount', { n: filtered.length })}</div></div>
        <a className="btn" href="#/import"><Icon name="import" />{t('import')}</a>
      </div>
      <div className="filters">
        <label className="field"><span>{t('search')}</span><input type="search" value={q} placeholder={t('searchPh')} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field"><span>{t('category')}</span>
          <select value={cat} onChange={(e) => setParam('cat', e.target.value)}>
            <option value="">{t('allCats')}</option>
            <option value="none">{t('uncategorized')}</option>
            {state.categories.filter((c) => !c.parentId).map((top) => (
              <optgroup key={top.id} label={top.name}>
                <option value={top.id}>{top.name}</option>
                {state.categories.filter((c) => c.parentId === top.id).map((c) => <option key={c.id} value={c.id}>{top.name} › {c.name}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field"><span>{t('month')}</span>
          <select value={month} onChange={(e) => setParam('month', e.target.value)}>
            <option value="">{t('allMonths')}</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m, 'longYear')}</option>)}
          </select>
        </label>
      </div>
      <div className="split">
        <section className="card flush split-main">
          {filtered.length === 0 ? <div className="empty">{t('noResults')}</div> : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>{t('date')}</th><th>{t('payee')}</th><th>{t('category')}</th><th className="r">{t('amount')}</th></tr></thead>
                <tbody>
                  {filtered.slice(0, limit).map((tx) => {
                    const name = lk.payeeName(tx.payeeId);
                    const open = () => setParam('tx', String(tx.id));
                    return (
                      <tr key={tx.id} className={`click ${tx.id === selId ? 'sel' : ''}`} onClick={open}>
                        <td className="num muted" style={{ whiteSpace: 'nowrap' }}>{date(tx.date)}</td>
                        <td>
                          <button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); open(); }}>
                            {name}{matched.has(tx.id) && <span className="muted"><Icon name="repeat" size={14} label={t('recurring')} /></span>}
                          </button>
                          {name !== tx.rawPayee && <div className="small muted ellipsis raw">{tx.rawPayee}</div>}
                        </td>
                        <td><CategoryChip categoryId={lk.categoryOf(tx)?.id} /></td>
                        <td><Amount cents={tx.amount} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length > limit && <div className="empty"><button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>{t('showMore')}</button></div>}
            </div>
          )}
        </section>
        {selected && <TransactionPanel key={selected.id} tx={selected} onClose={() => setParam('tx', null)} />}
      </div>
    </>
  );
}

function TransactionPanel({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { state, lk, mutate } = useData();
  const { t, money, date, pct, lang } = useSettings();
  const payee = state.payees.find((p) => p.id === tx.payeeId);
  const rule = resolveRule(tx.rawPayee, state.rules);
  const initial = {
    name: payee?.name ?? tx.rawPayee,
    matchType: (rule && !rule.auto ? rule.matchType : 'exact') as MatchType,
    pattern: rule && !rule.auto ? rule.pattern : tx.rawPayee,
    categoryId: payee?.categoryId ?? null
  };
  const [form, setForm] = useState(initial);
  const match = state.matches.find((m) => m.transactionId === tx.id);
  const matchedPlan = match && state.plans.find((p) => p.id === match.planId);
  const linkable = state.plans.filter((p) => p.status === 'active' && (p.type === 'recurring' || p.type === 'oneoff'));
  const [linkPlanId, setLinkPlanId] = useState<number | null>(null);

  const [rec, setRec] = useState({ on: false, name: null as string | null, frequency: 1, amount: formatAmountInput(tx.amount, lang), start: tx.date, end: '', endless: true });
  const recAmount = (parseAmountInput(rec.amount) ?? Math.abs(tx.amount)) * Math.sign(tx.amount);
  const history = useMemo(() => historyCandidates(state, tx, recAmount), [state, tx, recAmount]);
  const [picked, setPicked] = useState<Record<number, boolean>>({});
  const isPicked = (id: number) => picked[id] ?? history.find((h) => h.transaction.id === id)?.preselected ?? false;
  const pickedCount = history.filter((h) => isPicked(h.transaction.id)).length;

  const raws = useMemo(() => [...new Set(state.transactions.map((x) => x.rawPayee))], [state.transactions]);
  const affected = useMemo(() => {
    const hit = new Set(raws.filter((r) => ruleMatches(form.matchType, form.pattern, r)));
    return state.transactions.filter((x) => hit.has(x.rawPayee)).length;
  }, [raws, form.matchType, form.pattern, state.transactions]);

  const ruleChanged = form.name.trim() !== initial.name || form.matchType !== initial.matchType || form.pattern.trim() !== initial.pattern;

  const save = () => mutate(async () => {
    let payeeId = tx.payeeId;
    if (ruleChanged) {
      ({ payeeId } = await api<{ payeeId: number }>('POST', '/rules', { matchType: form.matchType, pattern: form.pattern, name: form.name, categoryId: form.categoryId }));
    } else if (form.categoryId !== initial.categoryId) {
      await api('PATCH', `/payees/${payeeId}`, { categoryId: form.categoryId });
    }
    const plan = linkable.find((p) => p.id === linkPlanId);
    if (plan) await api('POST', '/matches', [{ planId: plan.id, transactionId: tx.id, period: periodFor(plan, tx.date) }]);
    if (rec.on && !match) {
      const input = { type: 'recurring' as const, name: (rec.name ?? form.name).trim() || form.name, payeeId, categoryId: form.categoryId, frequency: rec.frequency, startDate: rec.start, endDate: rec.endless ? null : rec.end || null, amount: recAmount };
      const { id } = await api<{ id: number }>('POST', '/plans', input);
      const asPlan: Plan = { ...input, id, status: 'active', amounts: [{ id: 0, validFrom: input.startDate, amount: input.amount }] };
      const txs = [tx, ...history.filter((h) => isPicked(h.transaction.id)).map((h) => h.transaction)];
      await api('POST', '/matches', txs.map((x) => ({ planId: id, transactionId: x.id, period: periodFor(asPlan, x.date) })));
    }
  }).then((ok) => ok && onClose());

  return (
    <section className="card split-side sticky">
      <div className="form">
        <div className="between"><h2 className="h2">{t('editTx')}</h2><button type="button" className="iconbtn" onClick={onClose} aria-label={t('close')}><Icon name="close" /></button></div>
        <div>
          <Amount cents={tx.amount} className="kpi-v" />
          <div className="small muted">{date(tx.date)} · {tx.purpose}</div>
        </div>
        <div className="divider" />
        <div className="field"><span>{t('rawName')}</span><div className="hint num">{tx.rawPayee}</div></div>
        <label className="field"><span>{t('displayName')}</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="row2">
          <label className="field"><span>{t('rule')}</span>
            <select value={form.matchType} onChange={(e) => setForm({ ...form, matchType: e.target.value as MatchType })}>
              <option value="exact">{t('exact')}</option><option value="starts">{t('starts')}</option><option value="contains">{t('contains')}</option>
            </select>
          </label>
          <label className="field"><span>{t('pattern')}</span><input value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} /></label>
        </div>
        {ruleChanged && <div className="hint">{t('affects', { n: affected })}</div>}
        <label className="field"><span>{t('payeeCategory')}</span><CategorySelect value={form.categoryId} onChange={(categoryId) => setForm({ ...form, categoryId })} /></label>
        <div className="divider" />

        {matchedPlan ? (
          <div className="between hint" style={{ fontSize: 13 }}>
            <span>{t('linkedTo')}: <b>{matchedPlan.name}</b> · {date(match!.period)}</span>
            <button type="button" className="link" onClick={() => mutate(() => api('DELETE', `/matches/${match!.id}`))}>{t('unlink')}</button>
          </div>
        ) : (
          <>
            {linkable.length > 0 && !rec.on && (
              <label className="field"><span>{t('linkExisting')}</span>
                <select value={linkPlanId ?? ''} onChange={(e) => setLinkPlanId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t('choosePlan')}</option>
                  {linkable.map((p) => <option key={p.id} value={p.id}>{p.name} · {lk.payeeName(p.payeeId) || t(p.type === 'oneoff' ? 'typeOneoff' : 'typeRecurring')}</option>)}
                </select>
              </label>
            )}
            {!linkPlanId && (
              <label className="check"><input type="checkbox" checked={rec.on} onChange={(e) => setRec({ ...rec, on: e.target.checked })} /><span className="h2">{t('markRecurring')}</span></label>
            )}
            {rec.on && (
              <>
                <label className="field"><span>{t('name')}</span><input value={rec.name ?? form.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} /></label>
                <div className="row2">
                  <label className="field"><span>{t('frequency')}</span>
                    <select value={rec.frequency} onChange={(e) => setRec({ ...rec, frequency: Number(e.target.value) })}>
                      {[1, 3, 6, 12].map((f) => <option key={f} value={f}>{t(`freq${f}` as 'freq1')}</option>)}
                    </select>
                  </label>
                  <label className="field"><span>{t('amount')} (€)</span><input inputMode="decimal" value={rec.amount} onChange={(e) => setRec({ ...rec, amount: e.target.value })} /></label>
                </div>
                <div className="row2">
                  <label className="field"><span>{t('start')}</span><input type="date" value={rec.start} onChange={(e) => setRec({ ...rec, start: e.target.value })} /></label>
                  <label className="field"><span>{t('end')}</span><input type="date" value={rec.end} disabled={rec.endless} onChange={(e) => setRec({ ...rec, end: e.target.value })} /></label>
                </div>
                <label className="check"><input type="checkbox" checked={rec.endless} onChange={(e) => setRec({ ...rec, endless: e.target.checked })} /><span>{t('endless')}</span></label>
                <div className="field">
                  <span>{t('histTitle')}</span>
                  {history.length === 0 ? <div className="hint">{t('noHistory')}</div> : (
                    <>
                      <div className="small muted">{t('histNote')}</div>
                      <div className="hist">
                        {history.map((h) => (
                          <label key={h.transaction.id} className="hrow">
                            <input type="checkbox" checked={isPicked(h.transaction.id)} onChange={() => setPicked({ ...picked, [h.transaction.id]: !isPicked(h.transaction.id) })} />
                            <span className="num muted">{date(h.transaction.date)}</span>
                            <span><span className={`chip ${h.amountDiff < 0.005 ? 'ok' : h.preselected ? '' : 'warn'}`}>{h.amountDiff < 0.005 ? t('sameAmt') : t('diffShort', { p: pct(h.amountDiff) })}</span></span>
                            <span className="amt">{money(h.transaction.amount, { signed: true })}</span>
                          </label>
                        ))}
                      </div>
                      <div className="between">
                        <span className="small muted">{t('histCount', { a: pickedCount, b: history.length })}</span>
                        <span className="row" style={{ gap: 12 }}>
                          <button type="button" className="link small" onClick={() => setPicked(Object.fromEntries(history.map((h) => [h.transaction.id, true])))}>{t('selAll')}</button>
                          <button type="button" className="link small" onClick={() => setPicked(Object.fromEntries(history.map((h) => [h.transaction.id, false])))}>{t('selNone')}</button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" onClick={save}>{t('save')}</button>
        </div>
      </div>
    </section>
  );
}
