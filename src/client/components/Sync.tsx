import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncStatus } from '../../shared/types';
import { api, useData } from '../data';
import type { Key } from '../i18n';
import { useSettings } from '../settings';
import { Icon, Modal } from './ui';

const ERRORS: Record<string, Key> = { auth: 'syncErrAuth', access_denied: 'syncErrDenied', invalid_state: 'syncErrDenied' };

/** Sync state in the sidebar; opens the Google Drive dialog. Hidden when the server runs without sync. */
export function SyncButton() {
  const { state, reload } = useData();
  const { t, lang } = useSettings();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [open, setOpen] = useState(false);
  const revision = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api<SyncStatus>('GET', '/sync');
      // The data was replaced by the version from Drive: show it.
      if (revision.current !== null && s.revision !== revision.current) void reload();
      revision.current = s.revision;
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, [reload]);

  useEffect(() => { void refresh(); }, [state, refresh]);
  const busy = status?.state === 'pending' || status?.state === 'syncing';
  useEffect(() => {
    const timer = setInterval(() => void refresh(), busy ? 2_000 : 20_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [busy, refresh]);

  if (!status) return null;
  const time = status.lastSync && new Date(status.lastSync).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  const warn = status.state === 'conflict' || status.state === 'error' || (!status.connected && status.error === 'auth');
  const label = !status.connected ? t(status.error === 'auth' ? 'syncReconnect' : 'syncSetup')
    : busy ? t('syncing')
    : status.state === 'conflict' ? t('syncConflict')
    : status.state === 'error' ? t('syncFailed')
    : time ? t('syncedAt', { time }) : t('syncDrive');

  return (
    <>
      <button type="button" className={`link small row ${warn ? 'neg-warn' : ''}`} onClick={() => setOpen(true)}>
        <Icon name="cloud" size={14} />{label}
      </button>
      {open && <SyncDialog status={status} onStatus={setStatus} onClose={() => setOpen(false)} />}
    </>
  );
}

function SyncDialog({ status, onStatus, onClose }: { status: SyncStatus; onStatus: (s: SyncStatus) => void; onClose: () => void }) {
  const { reload } = useData();
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
  const run = (resolve?: 'local' | 'drive') => call(async () => {
    const s = await api<SyncStatus>('POST', '/sync/run', resolve ? { resolve } : {});
    if (resolve === 'drive') await reload();
    return s;
  });
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
    const state = status.state === 'pending' || status.state === 'syncing' ? 'syncing' : status.state;
    body = (
      <div className="form">
        <div className="between">
          <span className={`chip ${state === 'idle' ? 'ok' : state === 'syncing' ? '' : 'warn'}`}>
            {t(state === 'idle' ? 'syncOk' : state === 'syncing' ? 'syncing' : state === 'conflict' ? 'syncConflict' : 'syncFailed')}
          </span>
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
            : <button type="button" className="btn primary" disabled={busy || status.state === 'conflict'} onClick={() => run()}>{t('syncNow')}</button>}
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
