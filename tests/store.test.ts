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
});
