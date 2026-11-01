import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/server/db';
import { Store } from '../src/server/store';
import { DbFile, Sync } from '../src/server/sync';

/** In-memory stand-in for the Google OAuth and Drive endpoints the sync uses. */
class FakeDrive {
  files = new Map<string, { data: Buffer; md5: string; tag: string; trashed: boolean }>();
  revoked = false;
  verifier: string | null = null;
  uploads = 0;
  private next = 1;

  private put(id: string, data: Buffer, tag: string) {
    this.files.set(id, { data, md5: createHash('md5').update(data).digest('hex'), tag, trashed: false });
  }
  private meta(id: string) {
    const f = this.files.get(id)!;
    return { id, md5Checksum: f.md5, modifiedTime: '2026-11-01T00:00:00Z', webViewLink: `https://drive/${id}`, trashed: f.trashed };
  }

  fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.pathname === '/token') {
      const p = new URLSearchParams(String(init.body));
      if (p.get('grant_type') === 'authorization_code') {
        this.verifier = p.get('code_verifier');
        return json({ refresh_token: 'refresh' });
      }
      return this.revoked ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'access', expires_in: 3600 });
    }
    if (url.pathname === '/revoke') return json({});
    if (this.revoked) return json({ error: { message: 'Invalid Credentials' } }, 401);
    const body = init.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0);
    const m = url.pathname.match(/^(\/upload)?\/drive\/v3\/files(?:\/([^/]+))?$/)!;
    const [, upload, id] = m;
    if (!id && init.method === 'POST' && !upload) {
      const fid = `f${this.next++}`;
      this.put(fid, Buffer.alloc(0), JSON.parse(body.toString()).appProperties.financeTracker);
      return json({ id: fid });
    }
    if (!id && init.method === 'POST') {
      this.uploads++;
      const boundary = String((init.headers as Record<string, string>)['Content-Type']).split('boundary=')[1];
      const text = body.toString('latin1');
      const metaStart = text.indexOf('\r\n\r\n') + 4;
      const meta = JSON.parse(text.slice(metaStart, text.indexOf(`\r\n--${boundary}`, metaStart)));
      const dataStart = text.indexOf('\r\n\r\n', text.indexOf(`--${boundary}`, metaStart)) + 4;
      const fid = `f${this.next++}`;
      this.put(fid, body.subarray(dataStart, text.lastIndexOf(`\r\n--${boundary}--`)), meta.appProperties.financeTracker);
      return json(this.meta(fid));
    }
    if (!id) {
      const tag = url.searchParams.get('q')!.match(/value='(\w+)'/)![1];
      return json({ files: [...this.files.keys()].filter((k) => this.files.get(k)!.tag === tag && !this.files.get(k)!.trashed).map((k) => this.meta(k)) });
    }
    if (!this.files.has(id)) return json({ error: { message: 'File not found' } }, 404);
    if (init.method === 'PATCH') {
      this.uploads++;
      this.put(id, body, this.files.get(id)!.tag);
      return json(this.meta(id));
    }
    if (url.searchParams.get('alt') === 'media') return new Response(new Uint8Array(this.files.get(id)!.data));
    return json(this.meta(id));
  }) as typeof fetch;

  dbFile() { return [...this.files.values()].find((f) => f.tag === 'db'); }
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** One computer: its own database file and sync state, talking to the shared fake Drive. */
async function computer(drive: FakeDrive, connect = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ft-sync-'));
  dirs.push(dir);
  const file = path.join(dir, 'finance.db');
  const store = new Store(openDb(file));
  const sync = new Sync({
    file: path.join(dir, 'finance.google-drive.json'), db: new DbFile(file, store), redirectUri: 'http://127.0.0.1:4321/api/sync/callback',
    env: { clientId: 'id', clientSecret: 'secret' }, fetchFn: drive.fetch
  });
  if (connect) {
    const state = new URL(sync.beginAuth('http://localhost:4321/')).searchParams.get('state')!;
    await sync.finishAuth({ code: 'code', state });
    await sync.run();
  }
  return { store, sync };
}

const addPlan = (store: Store, name: string) =>
  store.createPlan({ type: 'oneoff', name, startDate: '2026-12-01', amount: -1000 });
const planNames = (store: Store) => store.state().plans.map((p) => p.name).sort();

describe('Google Drive sync', () => {
  it('signs in with PKCE and uploads existing data', async () => {
    const drive = new FakeDrive();
    const dir = mkdtempSync(path.join(tmpdir(), 'ft-sync-'));
    dirs.push(dir);
    const store = new Store(openDb(path.join(dir, 'finance.db')));
    addPlan(store, 'Laptop');
    const sync = new Sync({ file: path.join(dir, 's.json'), db: new DbFile(path.join(dir, 'finance.db'), store), redirectUri: 'x', env: { clientId: 'id', clientSecret: 's' }, fetchFn: drive.fetch });
    const url = new URL(sync.beginAuth('http://localhost:4321/'));
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(await sync.finishAuth({ code: 'c', state: url.searchParams.get('state')! })).toBe('http://localhost:4321/');
    expect(createHash('sha256').update(drive.verifier!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    await sync.run();
    expect(drive.dbFile()).toBeTruthy();
    expect(sync.status()).toMatchObject({ connected: true, state: 'idle', link: expect.stringContaining('https://drive/') });
  });

  it('uploads local changes only when something changed', async () => {
    const drive = new FakeDrive();
    const a = await computer(drive);
    addPlan(a.store, 'Laptop');
    await a.sync.run();
    const uploads = drive.uploads;
    await a.sync.run();
    expect(drive.uploads).toBe(uploads);
    addPlan(a.store, 'Fahrrad');
    await a.sync.run();
    expect(drive.uploads).toBe(uploads + 1);
  });

  it('takes the Drive data on a fresh install and picks up changes from another computer', async () => {
    const drive = new FakeDrive();
    const a = await computer(drive);
    addPlan(a.store, 'Laptop');
    await a.sync.run();

    const b = await computer(drive);
    expect(planNames(b.store)).toEqual(['Laptop']);
    expect(b.sync.revision).toBe(1);

    addPlan(b.store, 'Fahrrad');
    await b.sync.run();
    await a.sync.run();
    expect(planNames(a.store)).toEqual(['Fahrrad', 'Laptop']);

    // No ping-pong: further runs change nothing.
    const uploads = drive.uploads;
    await a.sync.run();
    await b.sync.run();
    expect(drive.uploads).toBe(uploads);
  });

  it('transfers nothing on its own, but reports unsynced changes and newer versions in Drive', async () => {
    const drive = new FakeDrive();
    const a = await computer(drive);
    addPlan(a.store, 'Laptop');
    await a.sync.run();
    const b = await computer(drive);
    expect(b.sync.status()).toMatchObject({ localChanges: false, remoteChanges: false });

    addPlan(a.store, 'Fahrrad');
    a.sync.changed();
    const uploads = drive.uploads;
    expect(a.sync.status()).toMatchObject({ state: 'idle', localChanges: true, remoteChanges: false });
    a.sync.start();
    await a.sync.check();
    expect(drive.uploads).toBe(uploads);

    await a.sync.run();
    expect(a.sync.status().localChanges).toBe(false);

    // The other computer only learns that Drive is newer; its data stays until it syncs.
    b.sync.start();
    expect((await b.sync.check()).remoteChanges).toBe(true);
    expect(planNames(b.store)).toEqual(['Laptop']);
    await b.sync.run();
    expect(planNames(b.store)).toEqual(['Fahrrad', 'Laptop']);
    expect(b.sync.status()).toMatchObject({ localChanges: false, remoteChanges: false });
  });

  it('stops at a conflict and lets the user choose', async () => {
    const drive = new FakeDrive();
    const a = await computer(drive);
    addPlan(a.store, 'Laptop');
    await a.sync.run();
    const b = await computer(drive);

    addPlan(a.store, 'Von A');
    await a.sync.run();
    addPlan(b.store, 'Von B');
    await b.sync.run();
    expect(b.sync.status().state).toBe('conflict');
    expect(planNames(b.store)).toEqual(['Laptop', 'Von B']);

    await b.sync.run('drive');
    expect(planNames(b.store)).toEqual(['Laptop', 'Von A']);
    expect(b.sync.status().state).toBe('idle');

    addPlan(a.store, 'A2');
    addPlan(b.store, 'B2');
    await a.sync.run();
    await b.sync.run();
    await b.sync.run('local');
    await a.sync.run();
    expect(planNames(a.store)).toEqual(['B2', 'Laptop', 'Von A']);
  });

  it('falls back to "not connected" when Google rejects the sign-in', async () => {
    const drive = new FakeDrive();
    const a = await computer(drive);
    drive.revoked = true;
    addPlan(a.store, 'Laptop');
    await a.sync.run().catch(() => undefined);
    expect(a.sync.status()).toMatchObject({ connected: false, state: 'off', error: 'auth' });
  });

  it('rejects files that are not a finance-tracker database', async () => {
    const drive = new FakeDrive();
    const a = await computer(drive);
    addPlan(a.store, 'Laptop');
    await a.sync.run();
    const f = drive.dbFile()!;
    f.data = Buffer.from('nonsense');
    f.md5 = 'x';
    await expect(a.sync.run('drive')).rejects.toThrow('not_a_database');
    expect(planNames(a.store)).toEqual(['Laptop']);
  });
});
