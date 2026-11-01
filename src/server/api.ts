import { Hono } from 'hono';
import { importers } from './importers';
import { HttpError, type Store } from './store';
import type { Resolution, Sync } from './sync';

/** Only send the browser back to the app itself after signing in with Google. */
function localUrl(s: unknown): string {
  try {
    const u = new URL(String(s));
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? u.href : '/';
  } catch {
    return '/';
  }
}

export function createApi(store: Store, sync?: Sync) {
  const api = new Hono();
  const id = (s: string) => Number(s);

  // Every successful write triggers a (debounced) upload to Google Drive.
  api.use('*', async (c, next) => {
    await next();
    if (sync && c.req.method !== 'GET' && c.res.status < 400 && !c.req.path.startsWith('/api/sync')) sync.changed();
  });

  api.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  api.get('/state', (c) => c.json(store.state()));

  if (sync) {
    api.get('/sync', (c) => c.json(sync.status()));
    api.put('/sync/credentials', async (c) => {
      const b = await c.req.json<{ clientId?: string; clientSecret?: string }>();
      if (!b.clientId?.trim() || !b.clientSecret?.trim()) throw new HttpError(400, 'Client-ID und Client-Secret angeben.');
      sync.setCredentials({ clientId: b.clientId, clientSecret: b.clientSecret });
      return c.json(sync.status());
    });
    api.post('/sync/connect', async (c) => {
      const b = await c.req.json<{ returnTo?: string }>().catch(() => ({} as { returnTo?: string }));
      if (!sync.status().configured) throw new HttpError(400, 'not_configured');
      return c.json({ url: sync.beginAuth(localUrl(b.returnTo)) });
    });
    api.get('/sync/callback', async (c) => c.redirect(localUrl(await sync.finishAuth(c.req.query()))));
    api.post('/sync/run', async (c) => {
      const b = await c.req.json<{ resolve?: Resolution }>().catch(() => ({} as { resolve?: Resolution }));
      if (b.resolve && b.resolve !== 'local' && b.resolve !== 'drive') throw new HttpError(400, 'invalid_resolution');
      await sync.run(b.resolve).catch(() => undefined);
      return c.json(sync.status());
    });
    api.delete('/sync', async (c) => {
      await sync.disconnect();
      return c.json(sync.status());
    });
  }

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
  api.patch('/transactions', async (c) => {
    const { ids, categoryId } = await c.req.json();
    store.updateTransactions(ids, categoryId ?? null);
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
