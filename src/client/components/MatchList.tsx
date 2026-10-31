import { Fragment, useState } from 'react';
import { suggestMatches, type MatchSuggestion } from '../../shared/matching';
import { amountAt } from '../../shared/plans';
import { api, useData } from '../data';
import { useSettings } from '../settings';
import { Amount } from './ui';

type Decision = 'linked' | 'rejected';

/**
 * Suggested links between bookings and planned payments. Each one is confirmed or
 * rejected individually; the list keeps its order while decisions come in.
 */
export function MatchList({ transactionIds, onDone }: { transactionIds?: number[]; onDone?: () => void }) {
  const { state, lk, mutate } = useData();
  const { t, money, date, pct } = useSettings();
  // Grouped by plan, oldest first, so a whole series can be confirmed at once.
  const [items] = useState<MatchSuggestion[]>(() => suggestMatches(state, transactionIds)
    .sort((a, b) => a.planId - b.planId || a.period.localeCompare(b.period)));
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [amountChange, setAmountChange] = useState<Record<number, boolean>>({});

  if (!items.length) return <div className="card empty">{t('noMatches')}</div>;
  const decided = items.filter((s) => decisions[s.transactionId]).length;

  const decide = (s: MatchSuggestion, d: Decision | null) => {
    if (d === 'linked' && !decisions[s.transactionId]) return linkMany([s]);
    return mutate(async () => {
      const prev = decisions[s.transactionId];
      if (prev === 'linked') {
        const m = state.matches.find((x) => x.transactionId === s.transactionId);
        if (m) await api('DELETE', `/matches/${m.id}`);
      }
      if (prev === 'rejected') await api('DELETE', '/dismissals', { planId: s.planId, transactionId: s.transactionId });
      if (d === 'linked') await linkCalls([s]);
      if (d === 'rejected') await api('POST', '/dismissals', { planId: s.planId, transactionId: s.transactionId });
    }).then((ok) => ok && setDecisions((x) => {
      const next = { ...x };
      if (d) next[s.transactionId] = d; else delete next[s.transactionId];
      return next;
    }));
  };

  /** Links bookings in one request; amount changes are only added where the amount really moves. */
  const linkCalls = async (list: MatchSuggestion[]) => {
    await api('POST', '/matches', list.map((s) => ({ planId: s.planId, transactionId: s.transactionId, period: s.period })));
    const current = new Map<number, { period: string; amount: number }[]>();
    for (const s of [...list].sort((a, b) => a.period.localeCompare(b.period))) {
      if (!hasChange(s) || amountChange[s.transactionId] === false) continue;
      const plan = state.plans.find((p) => p.id === s.planId)!;
      const tx = state.transactions.find((x) => x.id === s.transactionId)!;
      const added = current.get(plan.id) ?? [];
      const latest = added.filter((a) => a.period <= s.period).pop();
      if ((latest?.amount ?? amountAt(plan, s.period)) === tx.amount) continue;
      await api('POST', `/plans/${s.planId}/amounts`, { validFrom: s.period, amount: tx.amount });
      current.set(plan.id, [...added, { period: s.period, amount: tx.amount }]);
    }
  };

  const linkMany = (list: MatchSuggestion[]) => mutate(() => linkCalls(list))
    .then((ok) => ok && setDecisions((x) => ({ ...x, ...Object.fromEntries(list.map((s) => [s.transactionId, 'linked' as Decision])) })));

  const open = items.filter((s) => !decisions[s.transactionId]);
  const clear = open.filter((s) => s.amountDiff < 0.005 && Math.abs(s.dayDiff) <= 3);

  const hasChange = (s: MatchSuggestion) => state.plans.find((p) => p.id === s.planId)?.type === 'recurring' && s.amountDiff >= 0.005;

  return (
    <div className="stack">
      <div className="between">
        <span className="muted">{t('matchIntro')}</span>
        {clear.length > 0 && <button type="button" className="btn primary" title={t('acceptExactHint')} onClick={() => linkMany(clear)}>{t('acceptExact', { n: clear.length })}</button>}
      </div>
      {items.map((s, i) => {
        const tx = state.transactions.find((x) => x.id === s.transactionId);
        const plan = state.plans.find((p) => p.id === s.planId);
        if (!tx || !plan) return null;
        const d = decisions[s.transactionId];
        const notes = [
          s.amountDiff >= 0.005 ? t('diffAmt', { p: pct(s.amountDiff) }) : '',
          s.dayDiff > 0 ? t('diffDays', { d: s.dayDiff }) : s.dayDiff < 0 ? t('diffDaysBefore', { d: -s.dayDiff }) : ''
        ].filter(Boolean);
        const groupOpen = open.filter((x) => x.planId === plan.id);
        const head = i === 0 || items[i - 1].planId !== plan.id;
        return (
          <Fragment key={s.transactionId}>
          {head && (
            <div className="group-head">
              <span className="h2">{plan.name} <span className="small muted">· {items.filter((x) => x.planId === plan.id).length}</span></span>
              {groupOpen.length > 1 && <button type="button" className="btn sm" onClick={() => linkMany(groupOpen)}>{t('linkGroup', { n: groupOpen.length })}</button>}
            </div>
          )}
          <section className="card">
            <div className="match">
              <div className="mbox">
                <span className="small muted">{t('booked')}</span>
                <span className="strong ellipsis">{lk.payeeName(tx.payeeId)}</span>
                <span className="small muted num">{date(tx.date)}</span>
                <Amount cents={tx.amount} className="" />
              </div>
              <div className="marrow" aria-hidden="true">⇄</div>
              <div className="mbox">
                <span className="small muted">{t('expected')} · {plan.type === 'recurring' ? `${t('typeRecurring')} · ${t(`freq${plan.frequency}` as 'freq1')}` : t('typeOneoff')}</span>
                <span className="strong ellipsis">{plan.name}</span>
                <span className="small muted num">{date(s.period)}</span>
                <span className="num strong">{money(s.expectedAmount, { signed: true })}</span>
              </div>
            </div>
            <div className="mfoot">
              <span className={`chip ${notes.length ? 'warn' : 'ok'}`}>{notes.length ? notes.join(' · ') : t('exactMatch')}</span>
              {d ? (
                <div className="row">
                  <span className={`chip ${d === 'linked' ? 'ok' : ''}`}>{t(d)}</span>
                  <button type="button" className="link" onClick={() => decide(s, null)}>{t('undo')}</button>
                </div>
              ) : (
                <div className="row">
                  <button type="button" className="btn" onClick={() => decide(s, 'rejected')}>{t('reject')}</button>
                  <button type="button" className="btn primary" onClick={() => decide(s, 'linked')}>{t('link')}</button>
                </div>
              )}
            </div>
            {hasChange(s) && d !== 'rejected' && (
              <label className="check" style={{ marginTop: 12 }}>
                <input type="checkbox" disabled={!!d} checked={amountChange[s.transactionId] !== false}
                  onChange={(e) => setAmountChange({ ...amountChange, [s.transactionId]: e.target.checked })} />
                <span>{t('suggestChange', { date: date(s.period), amt: money(tx.amount, { signed: true }) })}</span>
              </label>
            )}
          </section>
          </Fragment>
        );
      })}
      <div className="between">
        <span className="small muted">{t('progress', { a: decided, b: items.length })}</span>
        {onDone && <button type="button" className="btn primary" onClick={onDone}>{decided < items.length ? t('later') : t('finish')}</button>}
      </div>
    </div>
  );
}
