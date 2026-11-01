import { describe, expect, it } from 'vitest';
import { forecast } from '../src/shared/forecast';
import { historyCandidates, suggestMatches } from '../src/shared/matching';
import { amountAt, groupRecurring, occurrences } from '../src/shared/plans';
import type { AppState, Plan, Transaction } from '../src/shared/types';

const plan = (p: Partial<Plan> & { amount?: number }): Plan => ({
  id: 1, type: 'recurring', name: 'Plan', payeeId: 1, categoryId: null, frequency: 1, startDate: '2026-01-15', endDate: null,
  status: 'active', amounts: [{ id: 1, validFrom: p.startDate ?? '2026-01-15', amount: p.amount ?? -1000 }], ...p
});
const tx = (id: number, date: string, amount: number, payeeId = 1): Transaction => ({
  id, date, valueDate: date, amount, rawPayee: 'x', purpose: '', iban: null, type: null, payeeId, categoryId: null, importId: 1
});
const state = (s: Partial<AppState>): AppState => ({
  categories: [], payees: [{ id: 1, name: 'Vermieter', categoryId: null, mixed: false }], rules: [], transactions: [], plans: [], matches: [],
  dismissals: [], ignoredRecurring: [], balance: null, ...s
});

describe('plans', () => {
  it('computes occurrences for monthly, quarterly and ended plans', () => {
    expect(occurrences(plan({}), '2026-03-01', '2026-05-31')).toEqual(['2026-03-15', '2026-04-15', '2026-05-15']);
    expect(occurrences(plan({ frequency: 3 }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    expect(occurrences(plan({ endDate: '2026-02-20' }), '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-02-15']);
  });

  it('clamps the due day to short months', () => {
    expect(occurrences(plan({ startDate: '2026-01-31' }), '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
  });

  it('uses the amount valid on a date', () => {
    const p = plan({});
    p.amounts.push({ id: 2, validFrom: '2026-06-01', amount: -1200 });
    expect(amountAt(p, '2026-05-15')).toBe(-1000);
    expect(amountAt(p, '2026-06-15')).toBe(-1200);
  });
});

describe('recurring groups', () => {
  it('groups by main category, folds subcategories and sums monthly equivalents', () => {
    const cat = (id: number, name: string, parentId: number | null = null, kind: 'expense' | 'income' = 'expense') => ({ id, name, parentId, color: '#000', kind });
    const s = state({
      categories: [cat(1, 'Wohnen'), cat(2, 'Miete', 1), cat(3, 'Versicherung', 1), cat(4, 'Einkommen', null, 'income'), cat(5, 'Abos')],
      payees: [{ id: 1, name: 'Vermieter', categoryId: 2, mixed: false }, { id: 2, name: 'Arbeitgeber', categoryId: 4, mixed: false }],
      plans: [
        plan({ id: 1, name: 'Miete', amount: -90000 }),
        plan({ id: 2, name: 'Haftpflicht', payeeId: null, categoryId: 3, frequency: 12, amount: -12000 }),
        plan({ id: 3, name: 'Gehalt', payeeId: 2, amount: 300000 }),
        plan({ id: 4, name: 'Alt', payeeId: null, categoryId: 5, endDate: '2026-02-01', amount: -999 }),
        plan({ id: 5, name: 'Sonstiges', payeeId: null, amount: -500 }),
        plan({ id: 6, name: 'Streaming', payeeId: null, categoryId: 5, amount: -1500 })
      ]
    });
    const g = groupRecurring(s, '2026-06-01');
    expect(g.map((x) => x.category?.name ?? null)).toEqual(['Einkommen', 'Wohnen', 'Abos', null]);
    expect(g[1].plans.map((p) => p.id)).toEqual([1, 2]);
    expect(g[1].monthly).toBe(-91000);
    expect(g[2].plans.map((p) => p.id)).toEqual([6, 4]);
    expect(g[2].monthly).toBe(-1500);
  });
});

describe('matching', () => {
  it('suggests the nearest occurrence of the same payee within tolerance', () => {
    const s = state({ plans: [plan({})], transactions: [tx(1, '2026-03-17', -1050), tx(2, '2026-03-17', -5000), tx(3, '2026-03-17', -1000, 2)] });
    expect(suggestMatches(s)).toEqual([{ transactionId: 1, planId: 1, period: '2026-03-15', expectedAmount: -1000, amountDiff: 0.05, dayDiff: 2 }]);
  });

  it('skips matched occurrences and dismissed pairs', () => {
    const transactions = [tx(1, '2026-03-15', -1000), tx(2, '2026-03-16', -1000)];
    expect(suggestMatches(state({ plans: [plan({})], transactions, matches: [{ id: 1, planId: 1, transactionId: 1, period: '2026-03-15' }] }))).toEqual([]);
    expect(suggestMatches(state({ plans: [plan({})], transactions: [transactions[0]], dismissals: [{ planId: 1, transactionId: 1 }] }))).toEqual([]);
  });

  it('lets only the closest booking settle one occurrence', () => {
    const s = state({ plans: [plan({})], transactions: [tx(1, '2026-03-20', -1000), tx(2, '2026-03-15', -1000)] });
    expect(suggestMatches(s).map((m) => m.transactionId)).toEqual([2]);
  });

  it('preselects earlier bookings with a similar amount', () => {
    const t = tx(9, '2026-05-01', -1000);
    const s = state({ transactions: [t, tx(1, '2026-04-01', -1050), tx(2, '2026-03-01', -2000), tx(3, '2026-06-01', -1000)] });
    expect(historyCandidates(s, t).map((h) => [h.transaction.id, h.preselected])).toEqual([[1, true], [2, false]]);
  });
});

describe('forecast', () => {
  const categories = [{ id: 10, name: 'Lebensmittel', parentId: null, color: '#000', kind: 'expense' as const }, { id: 11, name: 'Supermarkt', parentId: 10, color: '#000', kind: 'expense' as const }];
  const base = state({
    categories,
    payees: [{ id: 1, name: 'Vermieter', categoryId: null, mixed: false }, { id: 2, name: 'REWE', categoryId: 11, mixed: false }],
    balance: { date: '2026-10-20', amount: 100000 },
    transactions: [tx(1, '2026-10-01', -80000), tx(2, '2026-10-05', -12000, 2)],
    plans: [
      plan({ id: 1, startDate: '2026-01-01', amount: -80000 }),
      plan({ id: 2, type: 'budget', name: 'Lebensmittel', payeeId: null, categoryId: 10, startDate: '2026-01-01', amount: -30000 }),
      plan({ id: 3, type: 'oneoff', name: 'Geschenk', payeeId: null, startDate: '2026-11-10', amount: -5000 })
    ],
    matches: [{ id: 1, planId: 1, transactionId: 1, period: '2026-10-01' }]
  });

  it('counts only the remaining budget in the running month and skips paid occurrences', () => {
    const f = forecast(base, '2026-10-20', 2);
    expect(f.months.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(f.months[0].items).toEqual([expect.objectContaining({ type: 'budget', amount: -18000 })]);
    expect(f.months[0].end).toBe(82000);
    expect(f.months[1].outflow).toBe(-80000 - 30000 - 5000);
    expect(f.months[2].end).toBe(82000 - 115000 - 110000);
  });

  it('keeps unpaid occurrences of the running month as overdue', () => {
    const f = forecast({ ...base, matches: [] }, '2026-10-20', 0);
    expect(f.months[0].items.find((i) => i.type === 'recurring')).toMatchObject({ overdue: true, amount: -80000 });
  });
});
