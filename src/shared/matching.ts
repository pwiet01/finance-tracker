import { addDays, dayDiff } from './dates';
import { amountAt, occurrences } from './plans';
import { lookup } from './stats';
import type { AppState, Plan, Transaction } from './types';

export interface MatchSuggestion {
  transactionId: number;
  planId: number;
  /** The plan occurrence (due date) the booking would settle. */
  period: string;
  expectedAmount: number;
  /** Relative amount difference, 0.1 = 10 %. */
  amountDiff: number;
  /** Days the booking is after (+) or before (−) the due date. */
  dayDiff: number;
}

export const MATCH_DAYS = { recurring: 10, oneoff: 14 };
export const MATCH_MAX_AMOUNT_DIFF = 0.3;
/** Earlier bookings within this difference are preselected when marking something as recurring. */
export const HISTORY_PRESELECT_DIFF = 0.1;

const relDiff = (actual: number, expected: number) => Math.abs(actual - expected) / Math.max(1, Math.abs(expected));

/**
 * Suggests a plan for each unmatched booking. Nothing is linked automatically:
 * the user confirms or rejects each suggestion.
 */
export function suggestMatches(state: AppState, transactionIds?: number[]): MatchSuggestion[] {
  const lk = lookup(state);
  const matchedTx = new Set(state.matches.map((m) => m.transactionId));
  const taken = new Set(state.matches.map((m) => `${m.planId}|${m.period}`));
  const dismissed = new Set(state.dismissals.map((d) => `${d.planId}|${d.transactionId}`));
  const wanted = transactionIds ? new Set(transactionIds) : null;
  const plans = state.plans.filter((p) => p.status === 'active' && (p.type === 'recurring' || p.type === 'oneoff'));

  const candidates: MatchSuggestion[] = [];
  for (const t of state.transactions) {
    if (matchedTx.has(t.id) || (wanted && !wanted.has(t.id))) continue;
    let best: MatchSuggestion | undefined;
    for (const p of plans) {
      if (dismissed.has(`${p.id}|${t.id}`)) continue;
      const s = candidate(p, t, lk.categoryOf(t)?.id);
      if (!s || taken.has(`${p.id}|${s.period}`)) continue;
      if (!best || score(s) < score(best)) best = s;
    }
    if (best) candidates.push(best);
  }
  // One occurrence can only be settled once: the closest booking wins.
  const out: MatchSuggestion[] = [];
  for (const s of candidates.sort((a, b) => score(a) - score(b))) {
    const key = `${s.planId}|${s.period}`;
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(s);
  }
  return out.sort((a, b) => a.transactionId - b.transactionId);
}

function candidate(p: Plan, t: Transaction, txCategoryId: number | undefined): MatchSuggestion | undefined {
  if (p.type === 'recurring') {
    if (p.payeeId !== t.payeeId) return;
    const window = MATCH_DAYS.recurring;
    const dates = occurrences(p, addDays(t.date, -window), addDays(t.date, window));
    if (!dates.length) return;
    const period = dates.reduce((a, b) => (Math.abs(dayDiff(t.date, a)) <= Math.abs(dayDiff(t.date, b)) ? a : b));
    return build(p, t, period);
  }
  const related = (p.payeeId !== null && p.payeeId === t.payeeId) || (p.categoryId !== null && p.categoryId === txCategoryId);
  if (!related || Math.abs(dayDiff(t.date, p.startDate)) > MATCH_DAYS.oneoff) return;
  return build(p, t, p.startDate);
}

function build(p: Plan, t: Transaction, period: string): MatchSuggestion | undefined {
  const expected = amountAt(p, period);
  if (Math.sign(expected) !== Math.sign(t.amount)) return;
  const diff = relDiff(t.amount, expected);
  if (diff > MATCH_MAX_AMOUNT_DIFF) return;
  return { transactionId: t.id, planId: p.id, period, expectedAmount: expected, amountDiff: diff, dayDiff: dayDiff(t.date, period) };
}

const score = (s: MatchSuggestion) => Math.abs(s.dayDiff) + s.amountDiff * 100;

export interface HistoryCandidate {
  transaction: Transaction;
  amountDiff: number;
  preselected: boolean;
}

/** Earlier unmatched bookings of the same payee, for assigning them to a new recurring payment. */
export function historyCandidates(state: AppState, tx: Transaction, amount = tx.amount): HistoryCandidate[] {
  const matched = new Set(state.matches.map((m) => m.transactionId));
  return state.transactions
    .filter((t) => t.id !== tx.id && t.payeeId === tx.payeeId && t.date <= tx.date && !matched.has(t.id) && Math.sign(t.amount) === Math.sign(amount))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((t) => {
      const amountDiff = relDiff(t.amount, amount);
      return { transaction: t, amountDiff, preselected: amountDiff <= HISTORY_PRESELECT_DIFF };
    });
}
