import { createHash, randomBytes } from 'node:crypto';

// Minimal Google Drive client on plain fetch: OAuth for installed apps (loopback redirect + PKCE)
// and the few Drive v3 calls the sync needs. Scope drive.file: the app only sees files it created.

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const FOLDER_NAME = 'finance-tracker';
const FILE_NAME = 'finance-tracker.db';
/** Marks the app's files so they are found again on another computer. */
const TAG = { key: 'financeTracker', folder: 'folder', file: 'db' };
const FILE_FIELDS = 'id,md5Checksum,modifiedTime,webViewLink';

export type Fetch = typeof fetch;

export interface Credentials { clientId: string; clientSecret: string }

export interface DriveFile { id: string; md5Checksum: string; modifiedTime: string; webViewLink?: string }

export class DriveError extends Error {
  /** The refresh token was rejected (revoked, expired): the user has to connect again. */
  auth = false;
  constructor(public status: number, message: string) { super(message); }
}

const base64url = (b: Buffer) => b.toString('base64url');

/** Verifier and challenge for PKCE (RFC 7636). */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function authUrl(creds: Credentials, redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: creds.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256'
  });
  return `${AUTH_URL}?${q}`;
}

async function failure(res: Response): Promise<DriveError> {
  const body = await res.json().catch(() => ({})) as { error?: string | { message?: string }; error_description?: string };
  const msg = typeof body.error === 'string' ? body.error_description ?? body.error : body.error?.message;
  return new DriveError(res.status, msg ?? `HTTP ${res.status}`);
}

/** Trades the authorization code for a refresh token. */
export async function exchangeCode(creds: Credentials, code: string, redirectUri: string, verifier: string, fetchFn: Fetch = fetch): Promise<string> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri,
      grant_type: 'authorization_code', code_verifier: verifier
    })
  });
  if (!res.ok) throw await failure(res);
  const data = await res.json() as { refresh_token?: string };
  if (!data.refresh_token) throw new DriveError(400, 'Google did not return a refresh token.');
  return data.refresh_token;
}

export async function revoke(token: string, fetchFn: Fetch = fetch): Promise<void> {
  await fetchFn(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

export class Drive {
  private access: { token: string; expires: number } | null = null;
  private folderId: string | null = null;

  constructor(private creds: Credentials, private refreshToken: string, private fetchFn: Fetch = fetch) {}

  private async token(): Promise<string> {
    if (this.access && this.access.expires > Date.now() + 60_000) return this.access.token;
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.creds.clientId, client_secret: this.creds.clientSecret,
        refresh_token: this.refreshToken, grant_type: 'refresh_token'
      })
    });
    if (!res.ok) {
      const e = await failure(res);
      e.auth = res.status === 400 || res.status === 401;
      throw e;
    }
    const data = await res.json() as { access_token: string; expires_in: number };
    this.access = { token: data.access_token, expires: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  private async call(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await this.fetchFn(url, { ...init, headers: { ...init.headers as Record<string, string>, Authorization: `Bearer ${await this.token()}` } });
    if (res.status === 401 && retry) {
      // Access token revoked or expired early: get a new one once; if that fails, the refresh token is gone too.
      this.access = null;
      return this.call(url, init, false);
    }
    if (!res.ok) throw await failure(res);
    return res;
  }

  private async findTagged(value: string, extra: string): Promise<DriveFile | null> {
    const q = `appProperties has { key='${TAG.key}' and value='${value}' } and trashed = false${extra}`;
    const res = await this.call(`${API}/files?${new URLSearchParams({ q, fields: `files(${FILE_FIELDS})`, orderBy: 'modifiedTime desc', pageSize: '1', spaces: 'drive' })}`);
    const { files } = await res.json() as { files: DriveFile[] };
    return files[0] ?? null;
  }

  /** The database file in Drive, found by id or else by its tag; null if there is none. */
  async find(id?: string): Promise<DriveFile | null> {
    if (id) {
      try {
        const res = await this.call(`${API}/files/${id}?fields=${FILE_FIELDS},trashed`);
        const f = await res.json() as DriveFile & { trashed: boolean };
        if (!f.trashed) return f;
      } catch (e) {
        if (!(e instanceof DriveError) || e.status !== 404) throw e;
      }
    }
    return this.findTagged(TAG.file, '');
  }

  async download(id: string): Promise<Buffer> {
    const res = await this.call(`${API}/files/${id}?alt=media`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async folder(): Promise<string> {
    if (this.folderId) return this.folderId;
    const found = await this.findTagged(TAG.folder, " and mimeType = 'application/vnd.google-apps.folder'");
    if (found) return (this.folderId = found.id);
    const res = await this.call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder', appProperties: { [TAG.key]: TAG.folder } })
    });
    return (this.folderId = (await res.json() as { id: string }).id);
  }

  /** Replaces the content of the file with this id, or creates the file when no id is given. */
  async upload(data: Buffer, id?: string): Promise<DriveFile> {
    if (id) {
      const res = await this.call(`${UPLOAD}/files/${id}?uploadType=media&fields=${FILE_FIELDS}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(data)
      });
      return await res.json() as DriveFile;
    }
    const meta = { name: FILE_NAME, parents: [await this.folder()], mimeType: 'application/x-sqlite3', appProperties: { [TAG.key]: TAG.file } };
    const boundary = `ft${randomBytes(12).toString('hex')}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--`)
    ]);
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: new Uint8Array(body)
    });
    return await res.json() as DriveFile;
  }
}
