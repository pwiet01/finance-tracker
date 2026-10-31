import { dateInMonth, dayDiff, monthIndex, parts } from './dates';
import { MATCH_MAX_AMOUNT_DIFF } from './matching';
import { nextOccurrence, periodFor } from './plans';
import type { AppState, Plan, Transaction } from './types';

export type Frequency = 1 | 3 | 6 | 12;
export const FREQUENCIES: Frequency[] = [1, 3, 6, 12];

/** A recurring payment derived from past bookings, ready to be created as a plan. */
export interface RecurringSeries {
  /** Stable identity, used to remember ignored suggestions across imports. */
  key: string;
  payeeId: number;
  frequency: Frequency;
  startDate: string;
  /** Set when no booking arrived for a while: the series has most likely ended. */
  endDate: string | null;
  /** First entry starts with the plan; later entries are amount changes. */
  amounts: { validFrom: string; amount: number }[];
  /** Bookings to link, each with the occurrence it settles. */
  matches: { transactionId: number; period: string }[];
  firstDate: string;
  lastDate: string;
}

const AVG_MONTH = 30.44;
/** Allowed deviation in days from the expected gap between two bookings. */
const GAP_TOLERANCE: Record<Frequency, number> = { 1: 9, 3: 15, 6: 20, 12: 25 };
const MIN_BOOKINGS: Record<Frequency, number> = { 1: 3, 3: 3, 6: 2, 12: 2 };
/** Amounts closer than this count as unchanged. */
const SAME_AMOUNT = 0.005;
/**
 * When all bookings of a payee do not form a series, groups of (almost) equal amounts
 * are tried instead, e.g. two contracts with one insurer. Kept strict (identical amount,
 * at least four bookings), so that random shopping amounts do not line up by chance.
 */
const CLUSTER_MIN_BOOKINGS = 4;

const relDiff = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

/** Most plausible frequency from the gaps between bookings, or null when they are irregular. */
function detectFrequency(txs: Transaction[]): Frequency | null {
  const gaps = txs.slice(1).map((t, i) => dayDiff(t.date, txs[i].date));
  if (!gaps.length) return null;
  for (const f of FREQUENCIES) {
    if (txs.length < MIN_BOOKINGS[f]) continue;
    const expected = f * AVG_MONTH, tol = GAP_TOLERANCE[f];
    let regular = 0, missed = 0, bad = 0;
    for (const g of gaps) {
      const k = Math.round(g / expected);
      if (k === 1 && Math.abs(g - expected) <= tol) regular++;
      else if (k >= 2 && k <= 3 && Math.abs(g - k * expected) <= tol * 1.5) missed++;
      else bad++;
    }
    // A single skipped occurrence is fine, irregular gaps are not.
    if (bad === 0 && regular >= 1 && missed <= Math.max(1, Math.floor(gaps.length / 5))) return f;
  }
  return null;
}

/** Due date close to the first booking, on the typical booking day of the month. */
function startDateFor(txs: Transaction[]): string {
  const day = median(txs.map((t) => parts(t.date)[2]));
  const first = txs[0].date, m = monthIndex(first);
  return [m - 1, m, m + 1].map((i) => dateInMonth(i, day))
    .reduce((a, b) => (Math.abs(dayDiff(first, a)) <= Math.abs(dayDiff(first, b)) ? a : b));
}

/**
 * Builds a series from bookings without judging how regular they are: used for
 * bookings the user picked by hand. Returns null if the amounts jump too much
 * for later matching to work.
 */
export function buildSeries(input: Transaction[], today: string, frequency?: Frequency): RecurringSeries | null {
  if (!input.length) return null;
  const txs = [...input].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const freq = frequency ?? detectFrequency(txs) ?? 1;
  const startDate = startDateFor(txs);
  const plan: Plan = {
    id: 0, type: 'recurring', name: '', payeeId: txs[0].payeeId, categoryId: null, frequency: freq, startDate,
    endDate: null, status: 'active', amounts: []
  };

  // One booking per occurrence: the one closest to the due date wins.
  const byPeriod = new Map<string, Transaction>();
  for (const t of txs) {
    const period = periodFor(plan, t.date);
    const prev = byPeriod.get(period);
    if (!prev || Math.abs(dayDiff(t.date, period)) < Math.abs(dayDiff(prev.date, period))) byPeriod.set(period, t);
  }
  const settled = [...byPeriod.entries()].sort(([a], [b]) => a.localeCompare(b));

  // Amount levels: a new amount counts as a change once it shows up twice in a row (or last).
  const amounts = [{ validFrom: startDate, amount: settled[0][1].amount }];
  for (let i = 1; i < settled.length; i++) {
    const [period, t] = settled[i];
    const current = amounts[amounts.length - 1].amount;
    if (relDiff(t.amount, current) < SAME_AMOUNT) continue;
    if (Math.sign(t.amount) !== Math.sign(current)) return null;
    const next = settled[i + 1]?.[1];
    if (!next || relDiff(next.amount, t.amount) < SAME_AMOUNT) amounts.push({ validFrom: period, amount: t.amount });
  }
  // Steps larger than the matching tolerance would break future suggestions.
  if (amounts.some((a, i) => i > 0 && relDiff(a.amount, amounts[i - 1].amount) > MATCH_MAX_AMOUNT_DIFF)) return null;

  const lastPeriod = settled[settled.length - 1][0];
  const next = nextOccurrence(plan, lastPeriod);
  const ended = next !== null && dayDiff(today, next) > Math.max(15, GAP_TOLERANCE[freq] * 2);
  const direction = Math.sign(amounts[0].amount);
  return {
    key: `${plan.payeeId}|${direction}|${freq}|${Math.abs(amounts[0].amount)}`,
    payeeId: plan.payeeId!,
    frequency: freq,
    startDate,
    endDate: ended ? lastPeriod : null,
    amounts,
    matches: settled.map(([period, t]) => ({ transactionId: t.id, period })),
    firstDate: txs[0].date,
    lastDate: txs[txs.length - 1].date
  };
}

/** Strict check on top of buildSeries, for automatic suggestions. */
function detectSeries(txs: Transaction[], today: string): RecurringSeries | null {
  const freq = detectFrequency(txs);
  if (!freq) return null;
  const series = buildSeries(txs, today, freq);
  if (!series || series.matches.length < MIN_BOOKINGS[freq]) return null;
  // Most bookings must carry the amount valid at the time; otherwise it is just a frequent shop.
  const byId = new Map(txs.map((t) => [t.id, t]));
  const fitting = series.matches.filter((m) => {
    let amount = series.amounts[0].amount;
    for (const a of series.amounts) if (a.validFrom <= m.period) amount = a.amount;
    return relDiff(byId.get(m.transactionId)!.amount, amount) <= 0.05;
  }).length;
  if (fitting / series.matches.length < 0.6) return null;
  // Two bookings only are trusted when the amount is the same.
  if (series.matches.length === 2 && series.amounts.length > 1) return null;
  return series;
}

/** Groups bookings by identical amount (sorted by date within each group). */
function clusterByAmount(txs: Transaction[]): Transaction[][] {
  const groups = new Map<number, Transaction[]>();
  for (const t of txs) {
    const g = groups.get(t.amount);
    if (g) g.push(t); else groups.set(t.amount, [t]);
  }
  return [...groups.values()];
}

/**
 * Finds recurring payments in bookings that are not linked to any plan yet.
 * Payees that already have a recurring plan in the same direction are left to
 * the regular matching. Nothing is created here; the user picks what to keep.
 */
export function detectRecurring(state: AppState, today: string, opts: { transactionIds?: number[] } = {}): RecurringSeries[] {
  const matched = new Set(state.matches.map((m) => m.transactionId));
  const ignored = new Set(state.ignoredRecurring);
  const planned = new Set(state.plans.filter((p) => p.type === 'recurring' && p.payeeId !== null)
    .flatMap((p) => p.amounts.map((a) => `${p.payeeId}|${Math.sign(a.amount)}`)));
  const groups = new Map<string, Transaction[]>();
  for (const t of state.transactions) {
    if (matched.has(t.id) || t.amount === 0) continue;
    const key = `${t.payeeId}|${Math.sign(t.amount)}`;
    if (planned.has(key)) continue;
    const g = groups.get(key);
    if (g) g.push(t); else groups.set(key, [t]);
  }

  const found: RecurringSeries[] = [];
  for (const txs of groups.values()) {
    if (txs.length < 2) continue;
    txs.sort((a, b) => a.date.localeCompare(b.date));
    const whole = detectSeries(txs, today);
    if (whole) {
      found.push(whole);
      continue;
    }
    for (const c of clusterByAmount(txs)) {
      const s = c.length >= CLUSTER_MIN_BOOKINGS ? detectSeries(c, today) : null;
      if (s) found.push(s);
    }
  }

  const wanted = opts.transactionIds ? new Set(opts.transactionIds) : null;
  const monthly = (s: RecurringSeries) => Math.abs(s.amounts[s.amounts.length - 1].amount) / s.frequency;
  return found
    .filter((s) => !ignored.has(s.key) && (!wanted || s.matches.some((m) => wanted.has(m.transactionId))))
    .sort((a, b) => Number(a.endDate !== null) - Number(b.endDate !== null) || monthly(b) - monthly(a));
}
