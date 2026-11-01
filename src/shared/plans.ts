import { addDays, dateInMonth, dayDiff, monthIndex, parts } from './dates';
import type { AppState, Category, Plan } from './types';

/** Amount valid on the given date: the latest change on or before it, else the first one. */
export function amountAt(plan: Plan, date: string): number {
  const sorted = [...plan.amounts].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let amount = sorted[0]?.amount ?? 0;
  for (const a of sorted) if (a.validFrom <= date) amount = a.amount;
  return amount;
}

/** Due dates of a recurring plan within [from, to], both inclusive. */
export function occurrences(plan: Plan, from: string, to: string): string[] {
  if (plan.type !== 'recurring') return [];
  const day = parts(plan.startDate)[2];
  const start = monthIndex(plan.startDate);
  const freq = Math.max(1, plan.frequency);
  let i = Math.max(start, monthIndex(from));
  i += (freq - ((i - start) % freq)) % freq;
  const out: string[] = [];
  for (; i <= monthIndex(to); i += freq) {
    const d = dateInMonth(i, day);
    if (d < plan.startDate || d < from || d > to) continue;
    if (plan.endDate && d > plan.endDate) break;
    out.push(d);
  }
  return out;
}

/** The occurrence of a plan a booking settles: the nearest due date, else the booking date. */
export function periodFor(plan: Plan, date: string): string {
  if (plan.type !== 'recurring') return plan.startDate;
  const window = Math.max(20, plan.frequency * 10);
  const dates = occurrences(plan, addDays(date, -window), addDays(date, window));
  return dates.reduce<string | null>((best, d) => (!best || Math.abs(dayDiff(date, d)) < Math.abs(dayDiff(date, best)) ? d : best), null) ?? date;
}

export function nextOccurrence(plan: Plan, after: string): string | null {
  const [y] = parts(after);
  return occurrences(plan, after, `${y + 3}-12-31`).find((d) => d > after) ?? null;
}

/** Is a budget active in the month of the given date? */
export function budgetActive(plan: Plan, monthIdx: number): boolean {
  if (plan.type !== 'budget' || plan.status !== 'active') return false;
  if (monthIndex(plan.startDate) > monthIdx) return false;
  return !plan.endDate || monthIndex(plan.endDate) >= monthIdx;
}

export type OccurrenceStatus = 'paid' | 'due' | 'overdue';

/** Grace period before an unmatched occurrence counts as overdue. */
export const OVERDUE_AFTER_DAYS = 5;

export function occurrenceStatus(state: AppState, plan: Plan, date: string, today: string): OccurrenceStatus {
  if (state.matches.some((m) => m.planId === plan.id && m.period === date)) return 'paid';
  return dayDiff(today, date) > OVERDUE_AFTER_DAYS ? 'overdue' : 'due';
}

export function oneoffStatus(plan: Plan, today: string): 'done' | 'open' | 'overdue' | 'dismissed' {
  if (plan.status === 'done') return 'done';
  if (plan.status === 'dismissed') return 'dismissed';
  return dayDiff(today, plan.startDate) > OVERDUE_AFTER_DAYS ? 'overdue' : 'open';
}

/** Ids of a category and all its subcategories. */
export function subtree(categories: Category[], id: number): Set<number> {
  return new Set([id, ...categories.filter((c) => c.parentId === id).map((c) => c.id)]);
}

/** Category a plan falls under: its own, else its payee's. */
export function planCategoryId(state: AppState, plan: Plan): number | null {
  return plan.categoryId ?? state.payees.find((p) => p.id === plan.payeeId)?.categoryId ?? null;
}

export interface RecurringGroup {
  /** Main category of the group; null = uncategorised. */
  category: Category | null;
  plans: Plan[];
  /** Monthly equivalent of all running plans in the group (yearly ÷ 12 etc.). */
  monthly: number;
}

/**
 * Recurring plans grouped by main category (subcategories fold into their parent).
 * Income groups come first, then by monthly volume; uncategorised plans last.
 * Within a group running plans come before ended ones, larger amounts first.
 */
export function groupRecurring(state: AppState, today: string): RecurringGroup[] {
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const ended = (p: Plan) => p.endDate !== null && p.endDate < today;
  const groups = new Map<number | null, RecurringGroup>();
  for (const p of state.plans) {
    if (p.type !== 'recurring') continue;
    const c = byId.get(planCategoryId(state, p) ?? -1);
    const main = c?.parentId ? byId.get(c.parentId) ?? c : c ?? null;
    const key = main?.id ?? null;
    if (!groups.has(key)) groups.set(key, { category: main, plans: [], monthly: 0 });
    const g = groups.get(key)!;
    g.plans.push(p);
    if (!ended(p)) g.monthly += Math.round(amountAt(p, today) / Math.max(1, p.frequency));
  }
  for (const g of groups.values()) {
    g.plans.sort((a, b) => {
      if (ended(a) !== ended(b)) return ended(a) ? 1 : -1;
      const aa = amountAt(a, today), ab = amountAt(b, today);
      return (ab > 0 ? 1 : 0) - (aa > 0 ? 1 : 0) || Math.abs(ab) - Math.abs(aa) || a.name.localeCompare(b.name);
    });
  }
  return [...groups.values()].sort((a, b) =>
    Number(!a.category) - Number(!b.category)
    || Number(a.monthly <= 0) - Number(b.monthly <= 0)
    || Math.abs(b.monthly) - Math.abs(a.monthly)
    || (a.category?.name ?? '').localeCompare(b.category?.name ?? ''));
}
