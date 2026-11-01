import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '../../shared/types';
import { api, useData } from '../data';
import type { Key } from '../i18n';
import { useSettings } from '../settings';
import { Icon, Modal } from './ui';

const ERRORS: Record<string, Key> = { auth: 'syncErrAuth', access_denied: 'syncErrDenied', invalid_state: 'syncErrDenied' };

/** What the sidebar and the dialog say about the sync state. */
function notice(s: SyncStatus): { key: Key; warn: boolean } {
  if (!s.connected) return s.error === 'auth' ? { key: 'syncReconnect', warn: true } : { key: 'syncSetup', warn: false };
  if (s.state === 'syncing') return { key: 'syncing', warn: false };
  if (s.state === 'conflict') return { key: 'syncConflict', warn: true };
  if (s.state === 'error') return { key: 'syncFailed', warn: true };
  if (s.localChanges && s.remoteChanges) return { key: 'syncBoth', warn: true };
  if (s.localChanges) return { key: 'syncUnsaved', warn: true };
  if (s.remoteChanges) return { key: 'syncRemoteNewer', warn: true };
  return { key: 'syncOk', warn: false };
}

/** Look at Drive for a newer version at most this often when the window gets focus. */
const CHECK_EVERY_MS = 5 * 60_000;

/**
 * Sync state in the sidebar: shows unsynced local changes or a newer version in Drive, with a
 * button to sync. Opens the Google Drive dialog. Hidden when the server runs without sync.
 */
export function SyncButton() {
  const { state, reload } = useData();
  const { t } = useSettings();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const revision = useRef<number | null>(null);
  const checked = useRef(Date.now());

  const apply = useCallback((s: SyncStatus) => {
    // The data was replaced by the version from Drive: show it.
    if (revision.current !== null && s.revision !== revision.current) void reload();
    revision.current = s.revision;
    setStatus(s);
  }, [reload]);

  const refresh = useCallback(async () => {
    try {
      apply(await api<SyncStatus>('GET', '/sync'));
    } catch {
      setStatus(null);
    }
  }, [apply]);

  // After every change of the data, so "unsynced changes" shows up right away.
  useEffect(() => { void refresh(); }, [state, refresh]);
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - checked.current < CHECK_EVERY_MS) return void refresh();
      checked.current = Date.now();
      void api<SyncStatus>('POST', '/sync/check').then(apply).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, apply]);

  if (!status) return null;
  const n = notice(status);
  const canSync = status.connected && (status.localChanges || status.remoteChanges) && status.state !== 'conflict' && status.state !== 'syncing';

  const syncNow = async () => {
    setBusy(true);
    try {
      const s = await api<SyncStatus>('POST', '/sync/run', {});
      apply(s);
      if (s.state === 'conflict' || s.state === 'error') setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sync-line">
        <button type="button" className={`link small row ${n.warn ? 'neg-warn' : ''}`} onClick={() => setOpen(true)}>
          <Icon name="cloud" size={14} />{t(n.key)}
        </button>
        {canSync && <button type="button" className="btn sm" disabled={busy} onClick={syncNow}>{t(busy ? 'syncing' : 'syncShort')}</button>}
      </div>
      {open && <SyncDialog status={status} onStatus={apply} onClose={() => setOpen(false)} />}
    </>
  );
}

function SyncDialog({ status, onStatus, onClose }: { status: SyncStatus; onStatus: (s: SyncStatus) => void; onClose: () => void }) {
  const { t, lang } = useSettings();
  const [editCreds, setEditCreds] = useState(!status.configured);
  const [creds, setCreds] = useState({ clientId: '', clientSecret: '' });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const call = async (fn: () => Promise<SyncStatus | void>) => {
    setBusy(true);
    setFailure(null);
    try {
      const s = await fn();
      if (s) onStatus(s);
      return true;
    } catch (e) {
      setFailure((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveCreds = () => call(() => api<SyncStatus>('PUT', '/sync/credentials', creds)).then((ok) => ok && setEditCreds(false));
  const connect = () => call(async () => {
    const { url } = await api<{ url: string }>('POST', '/sync/connect', { returnTo: window.location.href });
    window.location.href = url;
  });
  const run = (resolve?: 'local' | 'drive') => call(() => api<SyncStatus>('POST', '/sync/run', resolve ? { resolve } : {}));
  // Opening the dialog looks at Drive for a newer version.
  useEffect(() => {
    if (status.connected) void api<SyncStatus>('POST', '/sync/check').then(onStatus).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const disconnect = () => {
    if (confirm(t('syncDisconnectConfirm'))) void call(() => api<SyncStatus>('DELETE', '/sync'));
  };

  const error = failure ?? status.error;
  const errorText = error && (ERRORS[error] ? t(ERRORS[error]) : t('syncErrOther', { msg: error }));

  let body;
  if (editCreds && !status.fromEnv) {
    body = (
      <div className="form">
        <p className="muted" style={{ margin: 0 }}>{t('syncIntro')}</p>
        <ol className="steps">
          <li>{t('syncStep1')} <a className="link" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer">{t('syncConsole')}</a></li>
          <li>{t('syncStep2')}</li>
          <li>{t('syncStep3')}</li>
        </ol>
        <label className="field"><span>{t('syncClientId')}</span><input value={creds.clientId} onChange={(e) => setCreds({ ...creds, clientId: e.target.value })} autoComplete="off" spellCheck={false} /></label>
        <label className="field"><span>{t('syncClientSecret')}</span><input type="password" value={creds.clientSecret} onChange={(e) => setCreds({ ...creds, clientSecret: e.target.value })} autoComplete="off" /></label>
        <div className="hint">{t('syncCredsLocal')}</div>
      </div>
    );
  } else if (!status.connected) {
    body = (
      <div className="form">
        <p className="muted" style={{ margin: 0 }}>{t('syncConnectIntro')}</p>
        {!status.fromEnv && <button type="button" className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setEditCreds(true)}>{t('syncEditCreds')}</button>}
      </div>
    );
  } else {
    const n = notice(status);
    body = (
      <div className="form">
        <div className="between">
          <span className={`chip ${n.warn ? 'warn' : status.state === 'idle' ? 'ok' : ''}`}>{t(n.key)}</span>
          {status.link && <a className="link small row" href={status.link} target="_blank" rel="noreferrer"><Icon name="cloud" size={14} />{t('syncOpenDrive')}</a>}
        </div>
        {status.lastSync && <div className="small muted">{t('syncLast', { when: new Date(status.lastSync).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) })}</div>}
        {status.state === 'conflict' && (
          <div className="banner" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <span>{t('syncConflictText')}</span>
            <span className="row" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn sm" disabled={busy} onClick={() => run('drive')}>{t('syncUseDrive')}</button>
              <button type="button" className="btn sm" disabled={busy} onClick={() => run('local')}>{t('syncUseLocal')}</button>
            </span>
          </div>
        )}
        {status.state !== 'conflict' && (status.localChanges || status.remoteChanges) && (
          <div className="small">{t(status.localChanges && status.remoteChanges ? 'syncBothText' : status.localChanges ? 'syncUnsavedText' : 'syncRemoteText')}</div>
        )}
        <div className="hint">{t('syncHow')}</div>
      </div>
    );
  }

  const footer = (
    <>
      <div className="row">
        {status.connected && <button type="button" className="btn danger" disabled={busy} onClick={disconnect}>{t('syncDisconnect')}</button>}
      </div>
      <div className="row">
        {editCreds && status.configured && <button type="button" className="btn" onClick={() => setEditCreds(false)}>{t('cancel')}</button>}
        {editCreds && !status.fromEnv
          ? <button type="button" className="btn primary" disabled={busy || !creds.clientId.trim() || !creds.clientSecret.trim()} onClick={saveCreds}>{t('save')}</button>
          : !status.connected
            ? <button type="button" className="btn primary" disabled={busy} onClick={connect}>{t('syncConnect')}</button>
            : <button type="button" className="btn primary" disabled={busy || status.state === 'conflict' || status.state === 'syncing'} onClick={() => run()}>{t(busy ? 'syncing' : 'syncNow')}</button>}
      </div>
    </>
  );

  return (
    <Modal open title={t('syncTitle')} onClose={onClose} footer={footer}>
      {body}
      {errorText && <div className="banner" style={{ marginTop: 14 }}>{errorText}</div>}
    </Modal>
  );
}
