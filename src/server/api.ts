import { Hono } from 'hono';
import { importers } from './importers';
import { HttpError, type Store } from './store';

export function createApi(store: Store) {
  const api = new Hono();
  const id = (s: string) => Number(s);

  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  api.get('/state', (c) => c.json(store.state()));
  api.get('/export', (c) => {
    c.header('Content-Disposition', `attachment; filename="finance-tracker-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ version: 1, exportedAt: new Date().toISOString(), ...store.state() });
  });

  api.get('/formats', (c) => c.json(importers.map((i) => ({ id: i.id, name: i.name }))));
  api.post('/import/preview', async (c) => {
    const { content } = await c.req.json();
    return c.json(store.previewImport(String(content ?? '')));
  });
  api.post('/import/commit', async (c) => {
    const { content, filename } = await c.req.json();
    return c.json(store.commitImport(String(content ?? ''), filename ?? null));
  });

  api.post('/rules/bulk', async (c) => c.json(store.saveRules(await c.req.json())));
  api.post('/rules', async (c) => c.json(store.saveRule(await c.req.json())));
  api.put('/rules/:id', async (c) => c.json(store.saveRule({ ...(await c.req.json()), id: id(c.req.param('id')) })));
  api.delete('/rules/:id', (c) => { store.deleteRule(id(c.req.param('id'))); return c.json({ ok: true }); });

  api.patch('/payees', async (c) => {
    const { ids, categoryId } = await c.req.json();
    store.updatePayees(ids, categoryId ?? null);
    return c.json({ ok: true });
  });
  api.patch('/payees/:id', async (c) => { store.updatePayee(id(c.req.param('id')), await c.req.json()); return c.json({ ok: true }); });

  api.post('/categories', async (c) => c.json(store.createCategory(await c.req.json())));
  api.patch('/categories/:id', async (c) => { store.updateCategory(id(c.req.param('id')), await c.req.json()); return c.json({ ok: true }); });
  api.delete('/categories/:id', (c) => { store.deleteCategory(id(c.req.param('id'))); return c.json({ ok: true }); });

  api.post('/plans/recurring', async (c) => c.json({ ids: store.createRecurringPlans(await c.req.json()) }));
  api.post('/recurring-ignores', async (c) => { store.ignoreRecurring(String((await c.req.json()).key)); return c.json({ ok: true }); });
  api.delete('/recurring-ignores', async (c) => { store.unignoreRecurring(String((await c.req.json()).key)); return c.json({ ok: true }); });
  api.post('/plans', async (c) => c.json({ id: store.createPlan(await c.req.json()) }));
  api.patch('/plans/:id', async (c) => { store.updatePlan(id(c.req.param('id')), await c.req.json()); return c.json({ ok: true }); });
  api.delete('/plans/:id', (c) => { store.deletePlan(id(c.req.param('id'))); return c.json({ ok: true }); });
  api.post('/plans/:id/amounts', async (c) => {
    const { validFrom, amount } = await c.req.json();
    store.addPlanAmount(id(c.req.param('id')), validFrom, amount);
    return c.json({ ok: true });
  });
  api.delete('/plan-amounts/:id', (c) => { store.deletePlanAmount(id(c.req.param('id'))); return c.json({ ok: true }); });

  api.post('/matches', async (c) => { store.addMatches(await c.req.json()); return c.json({ ok: true }); });
  api.delete('/matches/:id', (c) => { store.removeMatch(id(c.req.param('id'))); return c.json({ ok: true }); });
  api.post('/dismissals', async (c) => {
    const { planId, transactionId } = await c.req.json();
    store.dismiss(planId, transactionId);
    return c.json({ ok: true });
  });
  api.delete('/dismissals', async (c) => {
    const { planId, transactionId } = await c.req.json();
    store.undismiss(planId, transactionId);
    return c.json({ ok: true });
  });

  return api;
}
