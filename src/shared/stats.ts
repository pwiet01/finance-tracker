import { monthIndex, monthKey, monthStart } from './dates';
import type { AppState, Category, Transaction } from './types';

export interface Lookup {
  categoryOf: (t: Transaction) => Category | undefined;
  topOf: (c: Category | undefined) => Category | undefined;
  payeeName: (payeeId: number | null) => string;
}

export function lookup(state: AppState): Lookup {
  const cats = new Map(state.categories.map((c) => [c.id, c]));
  const payees = new Map(state.payees.map((p) => [p.id, p]));
  return {
    categoryOf: (t) => {
      const id = payees.get(t.payeeId)?.categoryId;
      return id ? cats.get(id) : undefined;
    },
    topOf: (c) => (c?.parentId ? cats.get(c.parentId) : c),
    payeeName: (id) => (id ? payees.get(id)?.name ?? '' : '')
  };
}

/** The last `count` month keys up to and including the month of `until`. */
export function recentMonths(until: string, count: number): string[] {
  const end = monthIndex(until);
  return Array.from({ length: count }, (_, i) => monthKey(monthStart(end - count + 1 + i)));
}

export interface MonthSummary {
  month: string;
  income: number;
  expenses: number;
  /** Net spending per main category id; key 0 = uncategorised. Only expense categories. */
  byCategory: Map<number, number>;
}

/**
 * Spending per main category and month. Refunds inside an expense category reduce
 * its spending; uncategorised money counts only when it goes out.
 */
export function monthlySummaries(state: AppState, months: string[]): MonthSummary[] {
  const lk = lookup(state);
  const byMonth = new Map<string, MonthSummary>(months.map((m) => [m, { month: m, income: 0, expenses: 0, byCategory: new Map() }]));
  for (const t of state.transactions) {
    const s = byMonth.get(monthKey(t.date));
    if (!s) continue;
    if (t.amount > 0) s.income += t.amount; else s.expenses -= t.amount;
    const top = lk.topOf(lk.categoryOf(t));
    if (top && top.kind !== 'expense') continue;
    if (!top && t.amount > 0) continue;
    const key = top?.id ?? 0;
    s.byCategory.set(key, (s.byCategory.get(key) ?? 0) - t.amount);
  }
  return months.map((m) => byMonth.get(m)!);
}

/** Spending per subcategory (key = category id; the main id collects bookings assigned to it directly). */
export function subcategorySummaries(state: AppState, topId: number, months: string[]): Map<number, number>[] {
  const lk = lookup(state);
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = months.map(() => new Map<number, number>());
  for (const t of state.transactions) {
    const i = idx.get(monthKey(t.date));
    if (i === undefined) continue;
    const c = lk.categoryOf(t);
    if (!c || lk.topOf(c)?.id !== topId) continue;
    out[i].set(c.id, (out[i].get(c.id) ?? 0) - t.amount);
  }
  return out;
}

/** Net spending of a category subtree in one month (positive = money spent). */
export function spentInMonth(state: AppState, categoryIds: Set<number>, month: string): number {
  const lk = lookup(state);
  let sum = 0;
  for (const t of state.transactions) {
    if (monthKey(t.date) !== month) continue;
    const c = lk.categoryOf(t);
    if (c && categoryIds.has(c.id)) sum -= t.amount;
  }
  return sum;
}
