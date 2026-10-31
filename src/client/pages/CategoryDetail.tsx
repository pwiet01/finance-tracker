import { useMemo, useState } from 'react';
import { monthKey } from '../../shared/dates';
import { subtree } from '../../shared/plans';
import { recentMonths, spentInMonth, subcategorySummaries } from '../../shared/stats';
import { StackedBars } from '../components/charts';
import { Amount, CategoryChip, Dot } from '../components/ui';
import { useData } from '../data';
import { useSettings } from '../settings';
import { budgetFor } from './Overview';

const OPACITIES = [1, 0.7, 0.48, 0.32, 0.2];

export function CategoryDetailPage({ id }: { id: number }) {
  const { state, today, lk } = useData();
  const { t, money, monthLabel, pct, date } = useSettings();
  const cat = state.categories.find((c) => c.id === id);
  const latest = state.transactions[0]?.date ?? today;
  const months = useMemo(() => recentMonths(latest, 6), [latest]);
  const initial = new URLSearchParams(location.hash.split('?')[1]).get('month');
  const [selected, setSelected] = useState(initial && months.includes(initial) ? initial : months[months.length - 1]);
  const perMonth = useMemo(() => subcategorySummaries(state, id, months), [state, id, months]);

  if (!cat) return <div className="empty">—</div>;

  // Subcategories plus "General" for bookings assigned to the main category itself.
  const subs = [
    ...state.categories.filter((c) => c.parentId === id).map((c) => ({ id: c.id, name: c.name })),
    { id, name: t('direct') }
  ].filter((s) => s.id !== id || perMonth.some((m) => m.get(id)));
  const styled = subs.map((s, i) => ({ ...s, opacity: OPACITIES[i % OPACITIES.length] }));
  const sel = months.indexOf(selected);
  const monthTotal = [...perMonth[sel].values()].reduce((a, b) => a + b, 0);
  const ids = subtree(state.categories, id);
  const spent = spentInMonth(state, ids, selected);
  const budget = budgetFor(state.plans, ids, selected);
  const txs = state.transactions.filter((tx) => monthKey(tx.date) === selected && ids.has(lk.categoryOf(tx)?.id ?? -1));

  return (
    <>
      <div className="head">
        <div>
          <a className="link" href="#/">← {t('back')}</a>
          <h1 className="h1 row" style={{ marginTop: 6, gap: 10 }}><Dot color={cat.color} size={14} />{cat.name}</h1>
        </div>
        <div className="muted">{monthLabel(selected, 'longYear')}: <b className="num">{money(-monthTotal)}</b></div>
      </div>

      {budget !== null && (
        <section className="card stack">
          <div className="between">
            <h2 className="h2">{t('budget')} · {money(budget, { whole: true })} {t('perMonth')}</h2>
            <span className={`chip ${spent > budget ? 'warn' : 'ok'}`}>
              {spent > budget ? t('over', { a: money(spent - budget) }) : t('left', { a: money(budget - spent) })}
            </span>
          </div>
          <div className="prog"><span style={{ width: `${Math.min(100, (Math.max(0, spent) / budget) * 100)}%`, background: spent > budget ? 'var(--warn)' : cat.color }} /></div>
          <div className="small muted">{t('spentOf', { a: money(spent), b: money(budget) })}</div>
        </section>
      )}

      <section className="card">
        <div className="between"><h2 className="h2">{t('bySub')}</h2><span className="small muted">{t('lastMonths', { n: 6 })}</span></div>
        <StackedBars
          selected={selected}
          onSelect={setSelected}
          months={months.map((m, i) => ({ key: m, segments: styled.map((s) => ({ color: cat.color, opacity: s.opacity, value: perMonth[i].get(s.id) ?? 0 })) }))}
        />
        <div className="legend">{styled.map((s) => <span key={s.id} className="lg"><Dot color={cat.color} opacity={s.opacity} />{s.name}</span>)}</div>
      </section>

      <section className="card flush">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t('subcategory')}</th><th style={{ width: '28%' }}>{t('share')}</th><th className="r">{t('avg')}</th><th className="r">{monthLabel(selected, 'long')}</th></tr></thead>
            <tbody>
              {styled.map((s) => {
                const v = perMonth[sel].get(s.id) ?? 0;
                const avg = perMonth.reduce((a, m) => a + (m.get(s.id) ?? 0), 0) / months.length;
                return (
                  <tr key={s.id}>
                    <td><span className="row strong"><Dot color={cat.color} opacity={s.opacity} />{s.name}</span></td>
                    <td>
                      <div className="row">
                        <div className="share"><span style={{ width: `${monthTotal > 0 ? (Math.max(0, v) / monthTotal) * 100 : 0}%`, background: cat.color, opacity: s.opacity }} /></div>
                        <span className="small muted num" style={{ width: 40, textAlign: 'right' }}>{pct(monthTotal > 0 ? Math.max(0, v) / monthTotal : 0)}</span>
                      </div>
                    </td>
                    <td className="r num muted">{money(-avg)}</td>
                    <td className="amt">{money(-v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card flush">
        <h2 className="h2" style={{ padding: '10px 10px 4px' }}>{t('recentTx', { month: monthLabel(selected, 'long') })}</h2>
        {txs.length === 0 ? <div className="empty">{t('noTx')}</div> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <tbody>
                {txs.map((tx) => (
                  <tr key={tx.id} className="click" onClick={() => { location.hash = `/transactions?tx=${tx.id}`; }}>
                    <td className="num muted" style={{ width: 110 }}>{date(tx.date)}</td>
                    <td className="strong">{lk.payeeName(tx.payeeId)}</td>
                    <td><CategoryChip categoryId={lk.categoryOf(tx)?.id} /></td>
                    <td><Amount cents={tx.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
