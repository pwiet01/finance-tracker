import { useEffect, useState } from 'react';
import type { ImportPreview, ImportResult } from '../../shared/types';
import { MatchList } from '../components/MatchList';
import { Amount, Icon } from '../components/ui';
import { api, useData } from '../data';
import { navigate } from '../router';
import { useSettings } from '../settings';

/** Bank exports come as UTF-8 or Windows-1252; try the strict one first. */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export function ImportPage() {
  const { state, mutate } = useData();
  const { t, money, date } = useSettings();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [formats, setFormats] = useState<string[]>([]);

  useEffect(() => { api<{ name: string }[]>('GET', '/formats').then((f) => setFormats(f.map((x) => x.name))).catch(() => {}); }, []);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    const content = await readText(f);
    try {
      setPreview(await api<ImportPreview>('POST', '/import/preview', { content }));
      setFile({ name: f.name, content });
      setStep(2);
    } catch (e) {
      setError((e as Error).message === 'unknown_format' ? t('unknownFormat') : t('error', { msg: (e as Error).message }));
    }
  };

  const commit = () => mutate(async () => {
    setResult(await api<ImportResult>('POST', '/import/commit', { filename: file!.name, content: file!.content }));
  }).then((ok) => ok && setStep(3));

  const count = (s: string) => preview?.rows.filter((r) => r.status === s).length ?? 0;
  const steps = [t('step1'), t('step2'), t('step3')];

  return (
    <>
      <div className="head"><h1 className="h1">{t('import')}</h1></div>
      <div className="steps">
        {steps.map((label, i) => (
          <span key={label} className={`step ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}`}><b>{i + 1}</b>{label}</span>
        ))}
      </div>

      {step === 1 && (
        <section className="card stack">
          <label className={`drop ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files[0]); }}>
            <input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} />
            <span className="muted"><Icon name="import" size={28} /></span>
            <span className="strong">{t('drop')}</span>
            <span className="small muted">{t('supported', { list: formats.join(', ') })}</span>
          </label>
          {error && <div className="banner">{error}</div>}
          <span className="small muted">{t('moreFormats')}</span>
        </section>
      )}

      {step === 2 && preview && file && (
        <>
          <div className="facts">
            <div className="fact"><div className="small muted">{t('file')}</div><div className="strong ellipsis">{file.name}</div></div>
            <div className="fact"><div className="small muted">{t('detected')}</div><div className="strong">{preview.format.name}</div></div>
            <div className="fact"><div className="small muted">{t('balance')}</div><div className="strong num">{preview.balance ? `${money(preview.balance.amount)} · ${date(preview.balance.date)}` : '—'}</div></div>
            <div className="fact"><div className="small muted">{t('transactions')}</div><div className="strong">{t('importSummary', { a: count('new'), b: count('duplicate'), c: count('pending') })}</div></div>
          </div>
          {preview.errors.length > 0 && <div className="banner" title={preview.errors.join('\n')}>{t('lineErrors', { n: preview.errors.length })}</div>}
          <section className="card flush">
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>{t('status')}</th><th>{t('date')}</th><th>{t('payee')}</th><th className="r">{t('amount')}</th></tr></thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td><span className={`chip ${r.status === 'new' ? 'acc' : ''}`}>{t(r.status === 'new' ? 'stNew' : r.status === 'duplicate' ? 'stDup' : 'stPending')}</span></td>
                      <td className="num muted">{date(r.date)}</td>
                      <td>
                        <div className="strong">{r.payeeName}</div>
                        {r.ruleApplied && <div className="small muted">{t('ruleApplied')}: {r.rawPayee}</div>}
                      </td>
                      <td><Amount cents={r.amount} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => { setStep(1); setPreview(null); }}>{t('cancel')}</button>
            <button type="button" className="btn primary" disabled={count('new') === 0} onClick={commit}>{t('importNow')}</button>
          </div>
        </>
      )}

      {step === 3 && result && (
        <>
          <div className="banner info">{t('imported', { n: result.inserted })}</div>
          {state.plans.length > 0
            ? <MatchList transactionIds={result.transactionIds} onDone={() => navigate('/transactions')} />
            : <div><a className="btn primary" href="#/transactions">{t('toTransactions')}</a></div>}
        </>
      )}
    </>
  );
}
