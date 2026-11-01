import { useMemo, useState } from 'react';
import { dateInMonth, monthIndex } from '../../shared/dates';
import { suggestMatches } from '../../shared/matching';
import { amountAt, budgetActive, subtree } from '../../shared/plans';
import { detectRecurring } from '../../shared/recurring';
import { monthlySummaries, recentMonths } from '../../shared/stats';
import { StackedBars } from '../components/charts';
import { Dot, Icon } from '../components/ui';
import { useData } from '../data';
import { navigate } from '../router';
import { useSettings } from '../settings';

export const UNCATEGORIZED_COLOR = '#ADB5BD';

/** Sum of active budgets for a main category and its subcategories in a month (positive cents). */
export function budgetFor(plans: ReturnType<typeof useData>['state']['plans'], ids: Set<number>, month: string): number | null {
  const idx = monthIndex(`${month}-01`);
  const list = plans.filter((p) => p.categoryId && ids.has(p.categoryId) && budgetActive(p, idx));
  return list.length ? -list.reduce((s, p) => s + amountAt(p, dateInMonth(idx, 1)), 0) : null;
}

export function OverviewPage() {
  const { state, lk, today } = useData();
  const { t, money, monthLabel, pct } = useSettings();
  const latest = state.transactions[0]?.date ?? today;
  const months = useMemo(() => recentMonths(latest, 6), [latest]);
  const [selected, setSelected] = useState(months[months.length - 1]);
  const summaries = useMemo(() => monthlySummaries(state, months), [state, months]);
  const tops = state.categories.filter((c) => !c.parentId && c.kind === 'expense');
  const legend = [...tops.map((c) => ({ id: c.id, name: c.name, color: c.color })), { id: 0, name: t('uncategorized'), color: UNCATEGORIZED_COLOR }];
  const sum = summaries.find((s) => s.month === selected) ?? summaries[summaries.length - 1];
  const total = [...sum.byCategory.values()].reduce((a, b) => a + Math.max(0, b), 0);
  const uncategorized = state.transactions.filter((tx) => !lk.categoryOf(tx)).length;
  const suggestions = useMemo(() => suggestMatches(state).length, [state]);
  const detected = useMemo(() => detectRecurring(state, today).length, [state, today]);

  if (!state.transactions.length) {
    return (
      <>
        <h1 className="h1">{t('overview')}</h1>
        <section className="card stack" style={{ alignItems: 'flex-start' }}>
          <h2 className="h2">{t('welcomeTitle')}</h2>
          <p className="muted" style={{ margin: 0 }}>{t('welcomeText')}</p>
          <a className="btn primary" href="#/import"><Icon name="import" />{t('import')}</a>
        </section>
      </>
    );
  }

  const rows = legend
    .map((c) => ({ ...c, value: sum.byCategory.get(c.id) ?? 0, budget: c.id ? budgetFor(state.plans, subtree(state.categories, c.id), sum.month) : null }))
    .filter((r) => r.value > 0 || r.budget);

  return (
    <>
      <div className="head">
        <div>
          <h1 className="h1">{t('overview')}</h1>
          <div className="muted">{monthLabel(sum.month, 'longYear')}</div>
        </div>
        <a className="btn" href="#/import"><Icon name="import" />{t('import')}</a>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="small muted">{t('balance')}</div>
          <div className="kpi-v num">{state.balance ? money(state.balance.amount) : '—'}</div>
        </div>
        <div className="kpi"><div className="small muted">{t('income')}</div><div className="kpi-v num pos">{money(sum.income, { signed: true })}</div></div>
        <div className="kpi"><div className="small muted">{t('expenses')}</div><div className="kpi-v num">{money(-sum.expenses)}</div></div>
        <div className="kpi"><div className="small muted">{t('net')}</div><div className="kpi-v num">{money(sum.income - sum.expenses, { signed: true })}</div></div>
      </div>

      {uncategorized > 0 && (
        <div className="banner">
          <span>{t('toAssign', { n: uncategorized })}</span>
          <a className="link" href="#/categorize">{t('assignNow')}</a>
        </div>
      )}
      {detected > 0 && (
        <div className="banner info">
          <span>{t('detBanner', { n: detected })}</span>
          <a className="link" href="#/planning/detected">{t('review')}</a>
        </div>
      )}
      {suggestions > 0 && (
        <div className="banner info">
          <span>{t('openSuggestions', { n: suggestions })}</span>
          <a className="link" href="#/planning/matching">{t('review')}</a>
        </div>
      )}

      <section className="card">
        <div className="between"><h2 className="h2">{t('expByCat')}</h2><span className="small muted">{t('lastMonths', { n: 6 })} · {t('clickMonth')}</span></div>
        <StackedBars
          selected={sum.month}
          onSelect={setSelected}
          months={summaries.map((s) => ({ key: s.month, segments: legend.map((c) => ({ color: c.color, value: s.byCategory.get(c.id) ?? 0 })) }))}
        />
        <div className="legend">{legend.map((l) => <span key={l.id} className="lg"><Dot color={l.color} />{l.name}</span>)}</div>
      </section>

      <section className="card">
        <div className="between" style={{ marginBottom: 8 }}><h2 className="h2">{monthLabel(sum.month, 'longYear')}</h2><span className="small muted">{t('clickCat')}</span></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t('category')}</th><th style={{ width: '30%' }}>{t('share')}</th><th>{t('budget')}</th><th className="r">{t('amount')}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const open = () => navigate(r.id ? `/category/${r.id}?month=${sum.month}` : '/transactions?cat=none');
                return (
                  <tr key={r.id} className="click" onClick={open}>
                    <td><button type="button" className="rowbtn" onClick={open}><Dot color={r.color} />{r.name}</button></td>
                    <td>
                      <div className="row">
                        <div className="share"><span style={{ width: `${total ? (Math.max(0, r.value) / total) * 100 : 0}%`, background: r.color }} /></div>
                        <span className="small muted num" style={{ width: 40, textAlign: 'right' }}>{pct(total ? Math.max(0, r.value) / total : 0)}</span>
                      </div>
                    </td>
                    <td>{r.budget !== null && <span className={`chip ${r.value > r.budget ? 'warn' : ''}`}>{money(r.value, { whole: true })} {t('of')} {money(r.budget, { whole: true })}</span>}</td>
                    <td className="amt">{money(-r.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
