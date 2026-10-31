import { dateInMonth, dayDiff, monthIndex, parts } from './dates';
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
