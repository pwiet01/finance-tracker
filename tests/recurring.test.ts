import { describe, expect, it } from 'vitest';
import { buildSeries, detectRecurring } from '../src/shared/recurring';
import type { AppState, Plan, Transaction } from '../src/shared/types';

let nextId = 1;
const tx = (date: string, amount: number, payeeId = 1): Transaction => ({
  id: nextId++, date, valueDate: date, amount, rawPayee: 'x', purpose: '', iban: null, type: null, payeeId, importId: 1
});
const state = (transactions: Transaction[], s: Partial<AppState> = {}): AppState => ({
  categories: [], payees: [], rules: [], transactions, plans: [], matches: [], dismissals: [], ignoredRecurring: [], balance: null, ...s
});
const monthly = (from: number, to: number, day: number, amount: (m: number) => number, payeeId = 1) =>
  Array.from({ length: to - from + 1 }, (_, i) => tx(`2026-${String(from + i).padStart(2, '0')}-${String(day).padStart(2, '0')}`, amount(from + i), payeeId));

describe('detectRecurring', () => {
  it('finds a monthly payment with its amount change and links every booking', () => {
    const txs = monthly(1, 10, 3, (m) => (m < 6 ? -1399 : -1799));
    const [s, ...rest] = detectRecurring(state(txs), '2026-10-20');
    expect(rest).toEqual([]);
    expect(s.frequency).toBe(1);
    expect(s.startDate).toBe('2026-01-03');
    expect(s.endDate).toBeNull();
    expect(s.amounts).toEqual([{ validFrom: '2026-01-03', amount: -1399 }, { validFrom: '2026-06-03', amount: -1799 }]);
    expect(s.matches).toHaveLength(10);
  });

  it('tolerates shifted booking days and one skipped month', () => {
    const txs = ['2026-01-01', '2026-01-30', '2026-03-02', '2026-05-01', '2026-06-01'].map((d) => tx(d, -5000));
    const [s] = detectRecurring(state(txs), '2026-06-10');
    expect(s.frequency).toBe(1);
    expect(s.matches).toHaveLength(5);
  });

  it('detects quarterly and yearly payments', () => {
    const q = ['2025-01-15', '2025-04-15', '2025-07-15', '2025-10-15'].map((d) => tx(d, -12000, 1));
    const y = ['2024-03-01', '2025-03-01', '2026-03-01'].map((d) => tx(d, -8990, 2));
    const found = detectRecurring(state([...q, ...y]), '2026-01-10');
    expect(found.find((s) => s.payeeId === 1)?.frequency).toBe(3);
    expect(found.find((s) => s.payeeId === 2)?.frequency).toBe(12);
  });

  it('marks a series without recent bookings as ended', () => {
    const [s] = detectRecurring(state(monthly(1, 4, 10, () => -999)), '2026-10-01');
    expect(s.endDate).toBe('2026-04-10');
  });

  it('ignores irregular shopping and frequent bookings', () => {
    const shop = ['2026-01-03', '2026-01-09', '2026-01-20', '2026-02-02', '2026-02-17', '2026-03-05'].map((d, i) => tx(d, -2000 - i * 700));
    const varying = monthly(1, 6, 5, (m) => -1000 * m, 2);
    expect(detectRecurring(state([...shop, ...varying]), '2026-06-10')).toEqual([]);
  });

  it('does not build series from shopping amounts that line up by chance', () => {
    const noise = Array.from({ length: 60 }, (_, i) => tx(`2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + ((i * 7) % 27)).padStart(2, '0')}`, -1000 - ((i * 37) % 900)));
    const chance = ['2025-03-17', '2025-09-17', '2026-03-17'].map((d, i) => tx(d, [-1865, -1866, -1864][i]));
    expect(detectRecurring(state([...noise, ...chance]), '2026-10-01')).toEqual([]);
  });

  it('separates two contracts of one payee by amount and skips one-off extras', () => {
    const a = monthly(1, 6, 1, () => -4500);
    const b = monthly(1, 6, 15, () => -1200);
    const extra = tx('2026-02-20', -29900);
    const found = detectRecurring(state([...a, ...b, extra]), '2026-06-20');
    expect(found.map((s) => s.amounts[0].amount).sort((x, y) => x - y)).toEqual([-4500, -1200]);
  });

  it('skips matched bookings, payees with a plan, ignored keys and unrelated imports', () => {
    const txs = monthly(1, 6, 1, () => -4500);
    const [s] = detectRecurring(state(txs), '2026-06-10');
    expect(detectRecurring(state(txs, { ignoredRecurring: [s.key] }), '2026-06-10')).toEqual([]);
    const plan: Plan = { id: 1, type: 'recurring', name: 'x', payeeId: 1, categoryId: null, frequency: 1, startDate: '2026-01-01', endDate: null, status: 'active', amounts: [{ id: 1, validFrom: '2026-01-01', amount: -4500 }] };
    expect(detectRecurring(state(txs, { plans: [plan] }), '2026-06-10')).toEqual([]);
    expect(detectRecurring(state(txs), '2026-06-10', { transactionIds: [9999] })).toEqual([]);
    expect(detectRecurring(state(txs), '2026-06-10', { transactionIds: [txs[5].id] })).toHaveLength(1);
  });
});

describe('buildSeries', () => {
  it('builds a series from hand-picked bookings, one per occurrence', () => {
    const txs = [tx('2026-01-05', -1000), tx('2026-02-05', -1000), tx('2026-02-07', -1000), tx('2026-03-05', -1000)];
    const s = buildSeries(txs, '2026-03-10')!;
    expect(s.frequency).toBe(1);
    expect(s.matches.map((m) => m.period)).toEqual(['2026-01-05', '2026-02-05', '2026-03-05']);
  });

  it('refuses amount jumps that later matching could not follow', () => {
    expect(buildSeries([tx('2026-01-05', -1000), tx('2026-02-05', -3000), tx('2026-03-05', -3000)], '2026-03-10')).toBeNull();
  });
});
