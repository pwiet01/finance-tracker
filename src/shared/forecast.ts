import { dateInMonth, monthEnd, monthIndex, monthKey, monthStart } from './dates';
import { amountAt, budgetActive, occurrenceStatus, occurrences, oneoffStatus, subtree } from './plans';
import { spentInMonth } from './stats';
import type { AppState } from './types';

export interface ForecastItem {
  /** null for budgets, which spread over the whole month. */
  date: string | null;
  planId: number;
  name: string;
  type: 'recurring' | 'budget' | 'oneoff';
  amount: number;
  overdue: boolean;
}

export interface ForecastMonth {
  month: string;
  /** True for the running month, which only contains what is still open. */
  current: boolean;
  items: ForecastItem[];
  inflow: number;
  outflow: number;
  end: number;
}

export interface Forecast {
  start: { date: string; amount: number };
  months: ForecastMonth[];
}

/**
 * Projects the balance from the latest known balance: the rest of the running month
 * plus `months` full months. Recurring payments that are already matched are skipped,
 * overdue ones stay in. Budgets count only what is left of them in the running month.
 */
export function forecast(state: AppState, today: string, months: number): Forecast {
  const start = state.balance ?? { date: today, amount: state.transactions.reduce((s, t) => s + t.amount, 0) };
  const first = monthIndex(today);
  let balance = start.amount;
  const out: ForecastMonth[] = [];

  for (let i = first; i <= first + months; i++) {
    const current = i === first;
    const from = monthStart(i), to = monthEnd(i);
    const items: ForecastItem[] = [];

    for (const p of state.plans) {
      if (p.status !== 'active') continue;
      if (p.type === 'recurring') {
        for (const d of occurrences(p, from, to)) {
          const status = occurrenceStatus(state, p, d, today);
          if (status === 'paid') continue;
          items.push({ date: d, planId: p.id, name: p.name, type: 'recurring', amount: amountAt(p, d), overdue: status === 'overdue' });
        }
      } else if (p.type === 'oneoff') {
        const status = oneoffStatus(p, today);
        const inMonth = p.startDate >= from && p.startDate <= to;
        const overdueNow = current && p.startDate < from;
        if (inMonth || overdueNow) {
          items.push({ date: overdueNow ? from : p.startDate, planId: p.id, name: p.name, type: 'oneoff', amount: amountAt(p, p.startDate), overdue: status === 'overdue' });
        }
      } else if (p.type === 'budget' && p.categoryId && budgetActive(p, i)) {
        let amount = amountAt(p, dateInMonth(i, 1));
        if (current) {
          // Budgets are negative; spending already booked this month uses part of it up.
          const spent = spentInMonth(state, subtree(state.categories, p.categoryId), monthKey(from));
          amount = Math.min(0, amount + Math.max(0, spent));
        }
        if (amount !== 0) items.push({ date: null, planId: p.id, name: p.name, type: 'budget', amount, overdue: false });
      }
    }

    items.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
    const inflow = items.filter((x) => x.amount > 0).reduce((s, x) => s + x.amount, 0);
    const outflow = items.filter((x) => x.amount < 0).reduce((s, x) => s + x.amount, 0);
    balance += inflow + outflow;
    out.push({ month: monthKey(from), current, items, inflow, outflow, end: balance });
  }
  return { start, months: out };
}
