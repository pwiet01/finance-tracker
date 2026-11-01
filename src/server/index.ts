import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApi } from './api';
import { openDb } from './db';
import { Store } from './store';
import { DbFile, Sync } from './sync';

const port = Number(process.env.PORT ?? 4321);
const dbFile = process.env.FT_DB ?? 'data/finance.db';
const store = new Store(openDb(dbFile));

// Google Drive sync. Credentials and tokens live next to the database, never inside it.
const sync = process.env.FT_SYNC === 'off' ? undefined : new Sync({
  file: dbFile.replace(/(\.db)?$/, '.google-drive.json'),
  db: new DbFile(dbFile, store),
  // Google allows any port on the loopback IP for desktop clients.
  redirectUri: `http://127.0.0.1:${port}/api/sync/callback`,
  env: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
});
sync?.start();

const app = new Hono();
app.route('/api', createApi(store, sync));

// In production the built frontend is served from here; in development Vite does it.
if (process.env.NODE_ENV === 'production' && existsSync('dist')) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}

// Bind to localhost only: the data leaves this machine only through the Google Drive sync, if enabled.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  const url = process.env.NODE_ENV === 'production' ? `http://localhost:${port}` : 'http://localhost:5173';
  console.log(`finance-tracker läuft auf ${url}  (Datenbank: ${dbFile})`);
});
