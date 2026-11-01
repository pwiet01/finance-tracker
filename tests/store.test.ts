import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/server/db';
import { Store } from '../src/server/store';

const sample = readFileSync(new URL('./fixtures/dkb-giro.csv', import.meta.url), 'utf8');

describe('Store', () => {
  let store: Store;
  beforeEach(() => { store = new Store(openDb(':memory:')); });

  it('seeds default categories with subcategories', () => {
    const { categories } = store.state();
    expect(categories.find((c) => c.name === 'Lebensmittel' && !c.parentId)).toBeTruthy();
    expect(categories.some((c) => c.parentId)).toBe(true);
  });

  it('imports new bookings, skips pending ones and detects duplicates on re-import', () => {
    const first = store.commitImport(sample, 'a.csv');
    expect(first.inserted).toBe(8);
    expect(store.state().balance).toEqual({ date: '2026-10-31', amount: 241837 });
    const preview = store.previewImport(sample);
    expect(preview.rows.filter((r) => r.status === 'duplicate')).toHaveLength(8);
    expect(store.commitImport(sample, 'a.csv').inserted).toBe(0);
  });

  it('keeps two identical bookings in one file apart', () => {
    store.commitImport(sample, 'a.csv');
    expect(store.state().transactions.filter((t) => t.amount === -2317)).toHaveLength(2);
  });

  it('renames via rules, also for later imports, and drops replaced automatic payees', () => {
    store.commitImport(sample, 'a.csv');
    const cat = store.state().categories.find((c) => c.name === 'Online')!;
    const { payeeId } = store.saveRule({ matchType: 'starts', pattern: 'amazon', name: 'Amazon', categoryId: cat.id });
    let s = store.state();
    const amazon = s.transactions.filter((t) => t.rawPayee.startsWith('AMAZON'));
    expect(amazon.every((t) => t.payeeId === payeeId)).toBe(true);
    expect(s.payees.some((p) => p.name.startsWith('AMAZON'))).toBe(false);
    expect(s.payees.find((p) => p.id === payeeId)?.categoryId).toBe(cat.id);

    const later = sample.replace('-49,90', '-59,90');
    store.commitImport(later, 'b.csv');
    s = store.state();
    expect(s.transactions.find((t) => t.amount === -5990)?.payeeId).toBe(payeeId);
  });

  it('merges payees when one is renamed to the name of another', () => {
    store.commitImport(sample, 'a.csv');
    const s = store.state();
    const rewe = s.payees.find((p) => p.name === 'REWE')!;
    const netto = s.payees.find((p) => p.name === 'Netto Marken-Discount')!;
    store.updatePayee(netto.id, { name: 'REWE' });
    const after = store.state();
    expect(after.payees.find((p) => p.id === netto.id)).toBeUndefined();
    expect(after.transactions.filter((t) => t.payeeId === rewe.id)).toHaveLength(3);
  });

  it('links plans and reopens one-offs when a link is removed', () => {
    store.commitImport(sample, 'a.csv');
    const tx = store.state().transactions[0];
    const planId = store.createPlan({ type: 'oneoff', name: 'Test', startDate: tx.date, amount: tx.amount });
    store.addMatches([{ planId, transactionId: tx.id, period: tx.date }]);
    let s = store.state();
    expect(s.plans.find((p) => p.id === planId)?.status).toBe('done');
    store.removeMatch(s.matches[0].id);
    s = store.state();
    expect(s.plans.find((p) => p.id === planId)?.status).toBe('active');
  });

  it('requires a category for budgets and removes them with their category', () => {
    expect(() => store.createPlan({ type: 'budget', name: 'x', startDate: '2026-01-01', amount: -100 })).toThrow();
    const food = store.state().categories.find((c) => c.name === 'Lebensmittel')!;
    store.createPlan({ type: 'budget', name: 'Lebensmittel', categoryId: food.id, startDate: '2026-01-01', amount: -30000 });
    store.deleteCategory(food.id);
    expect(store.state().plans).toHaveLength(0);
  });

  it('creates recurring plans with amount history, links and payee category in one go', () => {
    store.commitImport(sample, 'a.csv');
    const s = store.state();
    const [a, b] = s.transactions;
    const cat = s.categories.find((c) => c.name === 'Streaming')!;
    const [id] = store.createRecurringPlans([{
      name: 'Abo', payeeId: a.payeeId, categoryId: cat.id, frequency: 1, startDate: '2026-01-01', endDate: null,
      amounts: [{ validFrom: '2026-06-01', amount: -1200 }, { validFrom: '2026-01-01', amount: -1000 }],
      matches: [{ transactionId: a.id, period: '2026-01-01' }, { transactionId: b.id, period: '2026-02-01' }]
    }]);
    const after = store.state();
    const plan = after.plans.find((p) => p.id === id)!;
    expect(plan.amounts.map((x) => [x.validFrom, x.amount])).toEqual([['2026-01-01', -1000], ['2026-06-01', -1200]]);
    expect(after.matches.filter((m) => m.planId === id)).toHaveLength(2);
    expect(after.payees.find((p) => p.id === a.payeeId)?.categoryId).toBe(cat.id);
  });

  it('remembers ignored recurring suggestions', () => {
    store.ignoreRecurring('1|-1|1|999');
    expect(store.state().ignoredRecurring).toEqual(['1|-1|1|999']);
    store.unignoreRecurring('1|-1|1|999');
    expect(store.state().ignoredRecurring).toEqual([]);
  });

  it('gives single bookings their own category and keeps it when rules change', () => {
    store.commitImport(sample, 'a.csv');
    const s = store.state();
    const food = s.categories.find((c) => c.name === 'Supermarkt')!;
    const cafe = s.categories.find((c) => c.name === 'Bäckerei & Café')!;
    const rewe = s.payees.find((p) => p.name === 'REWE')!;
    store.updatePayee(rewe.id, { categoryId: food.id });
    const [one, other] = s.transactions.filter((t) => t.payeeId === rewe.id);
    store.updateTransactions([one.id], cafe.id);
    store.saveRule({ matchType: 'exact', pattern: 'REWE', name: 'Rewe' });
    const after = store.state();
    expect(after.transactions.find((t) => t.id === one.id)?.categoryId).toBe(cafe.id);
    expect(after.transactions.find((t) => t.id === other.id)?.categoryId).toBeNull();
    store.updateTransactions([one.id], null);
    expect(store.state().transactions.find((t) => t.id === one.id)?.categoryId).toBeNull();
  });

  it('keeps mixed payees without default category', () => {
    store.commitImport(sample, 'a.csv');
    const s = store.state();
    const cat = s.categories.find((c) => c.name === 'Online')!;
    const paypal = s.transactions.find((t) => t.rawPayee === 'PAYPAL')!;
    store.updatePayee(paypal.payeeId, { categoryId: cat.id });
    store.updatePayee(paypal.payeeId, { mixed: true });
    expect(store.state().payees.find((p) => p.id === paypal.payeeId)).toMatchObject({ mixed: true, categoryId: null });
    store.updatePayees([paypal.payeeId], cat.id);
    expect(store.state().payees.find((p) => p.id === paypal.payeeId)).toMatchObject({ mixed: false, categoryId: cat.id });
  });

  it('routes bookings to another payee by their purpose, also on later imports', () => {
    store.commitImport(sample, 'a.csv');
    const amazonRaw = 'AMAZON PAYMENTS EUROPE S.C.A.';
    const before = store.state().transactions.find((t) => t.rawPayee === amazonRaw)!;
    const { payeeId } = store.saveRule({ matchType: 'exact', pattern: amazonRaw, purpose: 'mktp', name: 'Marketplace' });
    let s = store.state();
    expect(s.transactions.find((t) => t.id === before.id)?.payeeId).toBe(payeeId);
    // The plain name rule stays for bookings whose purpose does not match.
    expect(s.rules.some((r) => r.auto && r.pattern === amazonRaw)).toBe(true);

    store.commitImport(sample.replace('-49,90;DE00ZZZ00000000001;M1;K1', '-5,00;;;').replace('AMZN Mktp DE', 'Gutschein'), 'b.csv');
    s = store.state();
    const voucher = s.transactions.find((t) => t.purpose.includes('Gutschein'))!;
    expect(voucher.payeeId).not.toBe(payeeId);
    expect(store.previewImport(sample).rows.find((r) => r.rawPayee === amazonRaw)?.payeeName).toBe('Marketplace');
  });

  it('saves several rules with one re-resolve and sets categories of several payees', () => {
    store.commitImport(sample, 'a.csv');
    const { payeeIds } = store.saveRules([
      { matchType: 'exact', pattern: 'REWE', name: 'Supermarkt' },
      { matchType: 'exact', pattern: 'Netto Marken-Discount', name: 'Supermarkt' }
    ]);
    expect(new Set(payeeIds).size).toBe(1);
    const s = store.state();
    expect(s.payees.some((p) => p.name === 'REWE')).toBe(false);
    const cat = s.categories.find((c) => c.name === 'Supermarkt')!;
    const others = s.payees.filter((p) => p.id !== payeeIds[0]).slice(0, 2).map((p) => p.id);
    store.updatePayees([payeeIds[0], ...others], cat.id);
    expect(store.state().payees.filter((p) => p.categoryId === cat.id)).toHaveLength(1 + others.length);
  });
});
