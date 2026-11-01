import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SyncState, SyncStatus } from '../shared/types';
import { checkDbFile, openDb } from './db';
import { authUrl, Drive, DriveError, exchangeCode, type Credentials, type Fetch, pkce, revoke } from './drive';
import type { Store } from './store';

/** The local database as the sync sees it. */
export interface LocalDb {
  snapshot(): Buffer;
  isEmpty(): boolean;
  /** Replaces all local data with the given database file content. */
  replace(data: Buffer): void;
}

/** LocalDb backed by the SQLite file the store works on. */
export class DbFile implements LocalDb {
  constructor(private file: string, private store: Store) {}

  snapshot(): Buffer {
    const tmp = path.join(tmpdir(), `ft-snap-${randomBytes(6).toString('hex')}.db`);
    try {
      this.store.snapshot(tmp);
      return readFileSync(tmp);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  isEmpty(): boolean { return this.store.isEmpty(); }

  replace(data: Buffer): void {
    const incoming = `${this.file}.incoming`;
    writeFileSync(incoming, data);
    try {
      checkDbFile(incoming);
    } catch (e) {
      rmSync(incoming, { force: true });
      throw e;
    }
    // Keep the data being replaced, just in case.
    const backup = this.file.replace(/(\.db)?$/, '.before-sync.db');
    rmSync(backup, { force: true });
    this.store.snapshot(backup);

    this.store.swap(new DatabaseSync(':memory:')).close();
    for (const ext of ['-wal', '-shm']) rmSync(this.file + ext, { force: true });
    renameSync(incoming, this.file);
    try {
      this.store.swap(openDb(this.file)).close();
    } catch (e) {
      copyFileSync(backup, this.file);
      this.store.swap(openDb(this.file)).close();
      throw e;
    }
  }
}

interface Config {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  fileId?: string;
  /** Hash of the local snapshot at the last sync. */
  localMd5?: string;
  /** Drive's md5Checksum of the file at the last sync. */
  remoteMd5?: string;
  lastSync?: string;
  link?: string;
}

export interface SyncOptions {
  /** JSON file for credentials and sync state. Kept outside the database so tokens are never uploaded. */
  file: string;
  db: LocalDb;
  redirectUri: string;
  env?: { clientId?: string; clientSecret?: string };
  fetchFn?: Fetch;
}

export type Resolution = 'local' | 'drive';

const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');

/**
 * Keeps the local database and one file in Google Drive in step, when the user asks for it:
 * local changes are uploaded, changes from another computer are downloaded; if both sides
 * changed, the user decides. Nothing is transferred automatically; the status only tells
 * whether there are local changes not in Drive yet, or a newer version in Drive.
 */
export class Sync {
  private cfg: Config;
  private drive: Drive | null = null;
  private state: SyncState = 'idle';
  private error: string | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Cached answer to "are there local changes since the last sync?"; null = compute again. */
  private localChanged: boolean | null = null;
  /** Result of the last look at Drive: the file there changed since the last sync. */
  private remoteChanged = false;
  private pendingAuth = new Map<string, { verifier: string; returnTo: string; at: number }>();
  revision = 0;

  constructor(private opts: SyncOptions) {
    this.cfg = existsSync(opts.file) ? JSON.parse(readFileSync(opts.file, 'utf8')) as Config : {};
  }

  private save() {
    mkdirSync(path.dirname(path.resolve(this.opts.file)), { recursive: true });
    writeFileSync(this.opts.file, JSON.stringify(this.cfg, null, 2), { mode: 0o600 });
    chmodSync(this.opts.file, 0o600);
  }

  private credentials(): Credentials | null {
    const env = this.opts.env ?? {};
    const clientId = env.clientId || this.cfg.clientId, clientSecret = env.clientSecret || this.cfg.clientSecret;
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  private client(): Drive | null {
    const creds = this.credentials();
    if (!creds || !this.cfg.refreshToken) return null;
    return (this.drive ??= new Drive(creds, this.cfg.refreshToken, this.opts.fetchFn));
  }

  status(): SyncStatus {
    const connected = !!this.client();
    return {
      configured: !!this.credentials(),
      fromEnv: !!(this.opts.env?.clientId && this.opts.env.clientSecret),
      connected,
      state: !connected ? 'off' : this.state,
      localChanges: connected && this.hasLocalChanges(),
      remoteChanges: connected && this.remoteChanged,
      lastSync: this.cfg.lastSync ?? null,
      error: this.error,
      link: this.cfg.link ?? null,
      redirectUri: this.opts.redirectUri,
      revision: this.revision
    };
  }

  /** Looks once whether Drive has a newer version; transfers nothing. */
  start() {
    void this.check().catch(() => undefined);
  }

  /** Local changes since the last sync. A fresh install with nothing entered yet has none. */
  private hasLocalChanges(): boolean {
    if (this.localChanged === null) {
      this.localChanged = this.cfg.localMd5 ? md5(this.opts.db.snapshot()) !== this.cfg.localMd5 : !this.opts.db.isEmpty();
    }
    return this.localChanged;
  }

  setCredentials(c: Credentials) {
    this.cfg = { ...this.cfg, clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() };
    this.drive = null;
    this.save();
  }

  /** URL of Google's consent page; the browser comes back to the redirect URI with a code. */
  beginAuth(returnTo: string): string {
    const creds = this.credentials();
    if (!creds) throw new Error('not_configured');
    const now = Date.now();
    for (const [k, v] of this.pendingAuth) if (now - v.at > 15 * 60_000) this.pendingAuth.delete(k);
    const state = randomBytes(16).toString('hex');
    const { verifier, challenge } = pkce();
    this.pendingAuth.set(state, { verifier, returnTo, at: now });
    return authUrl(creds, this.opts.redirectUri, state, challenge);
  }

  /**
   * Completes the OAuth flow with the code (or the error) Google sent back.
   * Returns where the browser should go back to; failures show up in the status.
   */
  async finishAuth(params: { code?: string; state?: string; error?: string }): Promise<string> {
    const pending = params.state ? this.pendingAuth.get(params.state) : undefined;
    const creds = this.credentials();
    if (!pending || !creds) {
      this.error = 'invalid_state';
      return '/';
    }
    this.pendingAuth.delete(params.state!);
    if (params.error || !params.code) {
      this.error = params.error ?? 'access_denied';
      return pending.returnTo;
    }
    try {
      this.cfg.refreshToken = await exchangeCode(creds, params.code, this.opts.redirectUri, pending.verifier, this.opts.fetchFn);
    } catch (e) {
      this.error = (e as Error).message;
      return pending.returnTo;
    }
    this.drive = null;
    this.error = null;
    this.state = 'idle';
    this.save();
    void this.check().catch(() => undefined);
    return pending.returnTo;
  }

  /** Forgets the Google account. The file in Drive stays. */
  async disconnect() {
    const token = this.cfg.refreshToken;
    this.cfg = { clientId: this.cfg.clientId, clientSecret: this.cfg.clientSecret };
    this.drive = null;
    this.error = null;
    this.state = 'idle';
    this.localChanged = null;
    this.remoteChanged = false;
    this.save();
    if (token) await revoke(token, this.opts.fetchFn);
  }

  /** Called after every local write, so the status shows the unsynced changes. */
  changed() {
    this.localChanged = null;
  }

  /** Asks Drive whether the file there changed since the last sync; transfers no data. */
  async check(): Promise<SyncStatus> {
    const run = this.queue.then(async () => {
      const drive = this.client();
      if (!drive) return;
      try {
        const remote = await drive.find(this.cfg.fileId);
        this.remoteChanged = !!remote && remote.md5Checksum !== this.cfg.remoteMd5;
        if (this.state === 'error') { this.state = 'idle'; this.error = null; }
      } catch (e) {
        // Only a lost sign-in matters here; being offline is no failed sync.
        if (e instanceof DriveError && e.auth) this.failed(e);
      }
    });
    this.queue = run.catch(() => undefined);
    await run;
    return this.status();
  }

  /**
   * Syncs now. Without a resolution an existing conflict is left alone;
   * 'local' overwrites Drive with the local data, 'drive' replaces the local data.
   */
  async run(resolve?: Resolution): Promise<SyncStatus> {
    // One run at a time, in order.
    const run = this.queue.then(() => this.once(resolve));
    this.queue = run.catch(() => undefined);
    await run;
    return this.status();
  }

  private async once(resolve?: Resolution) {
    if (this.state === 'conflict' && !resolve) return;
    const drive = this.client();
    if (!drive) return;
    this.state = 'syncing';
    try {
      const local = this.opts.db.snapshot();
      const localMd5 = md5(local);
      const remote = await drive.find(this.cfg.fileId);
      // A fresh install with nothing entered yet takes the Drive data without asking.
      this.localChanged = null;
      const localChanged = this.hasLocalChanges();
      const remoteChanged = !!remote && remote.md5Checksum !== this.cfg.remoteMd5;

      const upload = async () => {
        const f = await drive.upload(local, remote?.id);
        this.done(f.id, localMd5, f.md5Checksum, f.webViewLink);
      };
      const download = async () => {
        this.opts.db.replace(await drive.download(remote!.id));
        this.revision++;
        this.done(remote!.id, md5(this.opts.db.snapshot()), remote!.md5Checksum, remote!.webViewLink);
      };

      if (!remote) {
        if (!this.opts.db.isEmpty()) await upload();
        else this.done(undefined, localMd5, undefined, undefined);
      } else if (resolve === 'local') await upload();
      else if (resolve === 'drive') await download();
      else if (remote.md5Checksum === localMd5) this.done(remote.id, localMd5, remote.md5Checksum, remote.webViewLink);
      else if (localChanged && remoteChanged) {
        this.state = 'conflict';
        this.error = null;
        this.remoteChanged = true;
        return;
      } else if (remoteChanged) await download();
      else if (localChanged) await upload();
      else this.done(remote.id, localMd5, remote.md5Checksum, remote.webViewLink);
      this.state = 'idle';
      this.error = null;
    } catch (e) {
      this.failed(e);
      throw e;
    }
  }

  private failed(e: unknown) {
    this.state = 'error';
    this.error = (e as Error).message;
    if (e instanceof DriveError && e.auth) {
      // Token revoked or expired: back to "not connected", keep the sync state for reconnecting.
      delete this.cfg.refreshToken;
      this.drive = null;
      this.error = 'auth';
      this.save();
    }
  }

  private done(fileId: string | undefined, localMd5: string, remoteMd5: string | undefined, link: string | undefined) {
    this.cfg = { ...this.cfg, fileId, localMd5, remoteMd5, link, lastSync: new Date().toISOString() };
    this.localChanged = false;
    this.remoteChanged = false;
    this.save();
  }
}
