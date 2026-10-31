import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApi } from './api';
import { openDb } from './db';
import { Store } from './store';

const port = Number(process.env.PORT ?? 4321);
const dbFile = process.env.FT_DB ?? 'data/finance.db';
const store = new Store(openDb(dbFile));

const app = new Hono();
app.route('/api', createApi(store));

// In production the built frontend is served from here; in development Vite does it.
if (process.env.NODE_ENV === 'production' && existsSync('dist')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

// Bind to localhost only: the data never leaves this machine.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const url = process.env.NODE_ENV === 'production' ? `http://localhost:${port}` : 'http://localhost:5173';
  console.log(`finance-tracker läuft auf ${url}  (Datenbank: ${dbFile})`);
});
