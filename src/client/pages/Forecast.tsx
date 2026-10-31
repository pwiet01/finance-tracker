import { useMemo, useState } from 'react';
import { forecast } from '../../shared/forecast';
import { BalanceChart } from '../components/charts';
import { Amount } from '../components/ui';
import { useData } from '../data';
import type { Key } from '../i18n';
import { useSettings } from '../settings';

const RANGES = [1, 3, 6, 12, 24, 36];

function storedRange(): number {
  try {
    const v = Number(localStorage.getItem('ft.forecastMonths'));
    return RANGES.includes(v) ? v : 12;
  } catch {
    return 12;
  }
}

export function ForecastPage() {
  const { state, today } = useData();
  const { t, money, date, monthLabel } = useSettings();
  const [months, setMonths] = useState(storedRange);
  const [open, setOpen] = useState<string | null>(null);
  const f = useMemo(() => forecast(state, today, months), [state, today, months]);
  const hasPlans = state.plans.some((p) => p.status === 'active');

  const pick = (n: number) => {
    setMonths(n);
    try { localStorage.setItem('ft.forecastMonths', String(n)); } catch { /* ignore */ }
  };

  const last = f.months[f.months.length - 1];
  const low = f.months.reduce((a, m) => (m.end < a.value ? { value: m.end, month: m.month } : a), { value: f.start.amount, month: '' });
  const long = f.months.length > 13;

  return (
    <>
      <div className="head">
        <div>
          <h1 className="h1">{t('forecast')}</h1>
          <div className="muted">{t('basis', { amt: money(f.start.amount), date: date(f.start.date) })}</div>
        </div>
        <div className="pills" role="group" aria-label={t('range')}>
          {RANGES.map((n) => (
            <button key={n} type="button" className={`pill ${n === months ? 'on' : ''}`} aria-pressed={n === months} onClick={() => pick(n)}>
              {t(n === 1 ? 'mo' : 'mos', { n })}
            </button>
          ))}
        </div>
      </div>

      {!hasPlans && <div className="banner info"><span>{t('forecastEmpty')}</span><a className="link" href="#/planning">{t('planning')}</a></div>}

      <div className="kpis">
        <div className="kpi"><div className="small muted">{t('today')}</div><div className="kpi-v num">{money(f.start.amount)}</div></div>
        <div className="kpi">
          <div className="small muted">{t('inN', { month: monthLabel(last.month, 'longYear') })}</div>
          <div className={`kpi-v num ${last.end < 0 ? 'neg-warn' : ''}`}>{money(last.end)}</div>
          <div className="small muted num">{money(last.end - f.start.amount, { signed: true })}</div>
        </div>
        <div className="kpi">
          <div className="small muted">{t('lowest')}</div>
          <div className={`kpi-v num ${low.value < 0 ? 'neg-warn' : ''}`}>{money(low.value)}</div>
          <div className="small muted">{low.month ? monthLabel(low.month, 'longYear') : t('today')}</div>
        </div>
      </div>

      <section className="card">
        <BalanceChart
          ariaLabel={`${t('chartAria')}: ${money(f.start.amount)} → ${money(last.end)}`}
          points={[{ label: t('today'), value: f.start.amount }, ...f.months.map((m) => ({ label: monthLabel(m.month, long ? 'shortYear' : 'short'), value: m.end }))]}
        />
      </section>

      <section className="card flush">
        <div className="mrow headrow"><span>{t('month')}</span><span className="r hide-s">{t('inflow')}</span><span className="r hide-s">{t('outflow')}</span><span className="r">{t('endBal')}</span><span /></div>
        {f.months.map((m) => {
          const isOpen = open === m.month;
          return (
            <div key={m.month}>
              <button type="button" className="mrow" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.month)}>
                <span className="strong">{monthLabel(m.month, 'longYear')}{m.current && <span className="muted small"> · {t('rest')}</span>}</span>
                <span className="r num pos hide-s">{money(m.inflow, { signed: true })}</span>
                <span className="r num hide-s">{money(m.outflow)}</span>
                <span className={`r num ${m.end < 0 ? 'neg-warn' : ''}`} style={{ fontWeight: 600 }}>{money(m.end)}</span>
                <span className="muted" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="mitems">
                  {m.items.length === 0 && <div className="small muted" style={{ padding: '6px 0' }}>—</div>}
                  {m.items.map((it, i) => (
                    <div key={i} className="mitem">
                      <span className="num muted">{it.date ? date(it.date, 'short') : t('wholeMonth')}</span>
                      <span className="ellipsis">{it.name}</span>
                      <span className="hide-s">
                        <span className={`chip ${it.overdue ? 'warn' : it.type === 'budget' ? 'acc' : ''}`}>
                          {it.overdue ? t('overdue') : t(({ recurring: 'typeRecurring', budget: 'typeBudget', oneoff: 'typeOneoff' } as Record<string, Key>)[it.type])}
                        </span>
                      </span>
                      <Amount cents={it.amount} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
