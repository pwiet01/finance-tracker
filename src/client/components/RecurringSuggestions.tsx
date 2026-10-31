import { Fragment, useState } from 'react';
import { detectRecurring, type RecurringSeries } from '../../shared/recurring';
import type { RecurringPlanInput } from '../../shared/types';
import { api, useData } from '../data';
import type { Key } from '../i18n';
import { useSettings } from '../settings';
import { Amount, CategorySelect } from './ui';

type Done = 'created' | 'ignored';
interface Draft { on: boolean; name: string; categoryId: number | null }

export function toPlanInput(s: RecurringSeries, name: string, categoryId: number | null): RecurringPlanInput {
  return { name, payeeId: s.payeeId, categoryId, frequency: s.frequency, startDate: s.startDate, endDate: s.endDate, amounts: s.amounts, matches: s.matches };
}

/**
 * Recurring payments found in unlinked bookings. Running ones are preselected;
 * one click creates them all, including amount changes and links to past bookings.
 */
export function RecurringSuggestions({ transactionIds, onDone }: { transactionIds?: number[]; onDone?: () => void }) {
  const { state, today, lk, mutate } = useData();
  const { t, date, money } = useSettings();
  const [items] = useState(() => detectRecurring(state, today, { transactionIds }));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(items.map((s) => [s.key, {
    on: s.endDate === null,
    name: lk.payeeName(s.payeeId),
    categoryId: state.payees.find((p) => p.id === s.payeeId)?.categoryId ?? null
  }])));
  const [done, setDone] = useState<Record<string, Done>>({});
  const [open, setOpen] = useState<string | null>(null);

  const edit = (key: string, patch: Partial<Draft>) => setDrafts({ ...drafts, [key]: { ...drafts[key], ...patch } });
  const pending = items.filter((s) => !done[s.key]);
  const chosen = pending.filter((s) => drafts[s.key].on);

  const create = () => mutate(async () => {
    await api('POST', '/plans/recurring', chosen.map((s) => toPlanInput(s, drafts[s.key].name.trim() || lk.payeeName(s.payeeId), drafts[s.key].categoryId)));
  }).then((ok) => ok && setDone({ ...done, ...Object.fromEntries(chosen.map((s) => [s.key, 'created' as Done])) }));

  const ignore = (s: RecurringSeries) => mutate(() => api('POST', '/recurring-ignores', { key: s.key }))
    .then((ok) => ok && setDone({ ...done, [s.key]: 'ignored' }));
  const unignore = (s: RecurringSeries) => mutate(() => api('DELETE', '/recurring-ignores', { key: s.key }))
    .then((ok) => ok && setDone(Object.fromEntries(Object.entries(done).filter(([k]) => k !== s.key))));

  const footer = onDone && <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn primary" onClick={onDone}>{t('continue')}</button></div>;
  if (!items.length) return <div className="stack"><div className="card empty">{t('detNone')}</div>{footer}</div>;
  const txById = new Map(state.transactions.map((x) => [x.id, x]));

  return (
    <div className="stack">
      <div className="between">
        <span className="muted">{t('detIntro')}</span>
        <span className="row">
          <button type="button" className="link small" onClick={() => setDrafts(Object.fromEntries(items.map((s) => [s.key, { ...drafts[s.key], on: true }])))}>{t('selAll')}</button>
          <button type="button" className="link small" onClick={() => setDrafts(Object.fromEntries(items.map((s) => [s.key, { ...drafts[s.key], on: false }])))}>{t('selNone')}</button>
          <button type="button" className="btn primary" disabled={!chosen.length} onClick={create}>{t('detCreate', { n: chosen.length })}</button>
        </span>
      </div>
      <section className="card flush">
        <div className="tbl-wrap">
          <table className="tbl" style={{ minWidth: 860 }}>
            <thead><tr><th style={{ width: 28 }} /><th>{t('name')}</th><th>{t('category')}</th><th>{t('frequency')}</th><th>{t('duration')}</th><th className="r">{t('amount')}</th><th /></tr></thead>
            <tbody>
              {items.map((s) => {
                const d = drafts[s.key], status = done[s.key];
                const last = s.amounts[s.amounts.length - 1];
                return (
                  <Fragment key={s.key}>
                    <tr style={status ? { opacity: 0.55 } : undefined}>
                      <td><input type="checkbox" aria-label={d.name} disabled={!!status} checked={!status && d.on} onChange={(e) => edit(s.key, { on: e.target.checked })} /></td>
                      <td>
                        <input value={d.name} disabled={!!status} onChange={(e) => edit(s.key, { name: e.target.value })} aria-label={t('name')} />
                        {d.name !== lk.payeeName(s.payeeId) && <div className="small muted">{lk.payeeName(s.payeeId)}</div>}
                      </td>
                      <td style={{ minWidth: 180 }}><CategorySelect value={d.categoryId} onChange={(categoryId) => edit(s.key, { categoryId })} /></td>
                      <td className="muted">{t(`freq${s.frequency}` as Key)}</td>
                      <td className="small">
                        <div className="muted">{t('since', { date: date(s.startDate) })}{s.endDate ? ` · ${t('until', { date: date(s.endDate) })}` : ''}</div>
                        <button type="button" className="link small" onClick={() => setOpen(open === s.key ? null : s.key)}>{t('detBookings', { n: s.matches.length })}</button>
                        {s.endDate ? <span className="chip" style={{ marginLeft: 6 }}>{t('ended')}</span> : <span className="small muted"> · {t('detLast', { date: date(s.lastDate) })}</span>}
                      </td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <Amount cents={last.amount} />
                        {s.amounts.slice(0, -1).reverse().map((a, i) => (
                          <div key={a.validFrom} className="change small muted">
                            {t('until', { date: date(s.amounts[s.amounts.length - 1 - i].validFrom) })}: {money(a.amount, { signed: true })}
                          </div>
                        ))}
                      </td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        {status === 'created' && <span className="chip ok">{t('detCreated')}</span>}
                        {status === 'ignored' && <span className="row"><span className="chip">{t('detIgnored')}</span><button type="button" className="link small" onClick={() => unignore(s)}>{t('undo')}</button></span>}
                        {!status && <button type="button" className="link small" onClick={() => ignore(s)}>{t('detIgnore')}</button>}
                      </td>
                    </tr>
                    {open === s.key && (
                      <tr><td /><td colSpan={6}>
                        <div className="hist">
                          {s.matches.map((m) => {
                            const x = txById.get(m.transactionId);
                            return x && (
                              <div key={m.transactionId} className="hrow" style={{ cursor: 'default' }}>
                                <span />
                                <span className="num muted">{date(x.date)}</span>
                                <span className="small muted ellipsis">{x.purpose}</span>
                                <Amount cents={x.amount} />
                              </div>
                            );
                          })}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {footer}
    </div>
  );
}
