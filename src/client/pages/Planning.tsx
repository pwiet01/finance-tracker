import { useMemo, useState } from 'react';
import { dateInMonth, monthIndex, monthKey } from '../../shared/dates';
import { suggestMatches } from '../../shared/matching';
import { amountAt, endedRecurring, groupRecurring, monthlyAmount, nextOccurrence, occurrenceStatus, occurrences, oneoffStatus, planCategoryId, subtree } from '../../shared/plans';
import { spentInMonth } from '../../shared/stats';
import type { Plan, PlanType } from '../../shared/types';
import { MatchList } from '../components/MatchList';
import { RecurringSuggestions } from '../components/RecurringSuggestions';
import { detectRecurring } from '../../shared/recurring';
import { Amount, CategoryChip, CategorySelect, Dot, Icon, Modal, categoryLabel, formatAmountInput, parseAmountInput } from '../components/ui';
import { api, useData } from '../data';
import type { Key } from '../i18n';
import { navigate } from '../router';
import { useSettings } from '../settings';

const TABS: { id: string; type?: PlanType; label: Key; create?: Key }[] = [
  { id: 'recurring', type: 'recurring', label: 'tabRecurring', create: 'newRecurring' },
  { id: 'budgets', type: 'budget', label: 'tabBudgets', create: 'newBudget' },
  { id: 'oneoff', type: 'oneoff', label: 'tabOneoff', create: 'newOneoff' },
  { id: 'detected', label: 'tabDetected' },
  { id: 'matching', label: 'tabMatching' }
];

export function PlanningPage({ tab = 'recurring' }: { tab?: string }) {
  const { state, today } = useData();
  const { t } = useSettings();
  const current = TABS.find((x) => x.id === tab) ?? TABS[0];
  const [editing, setEditing] = useState<{ type: PlanType; plan?: Plan } | null>(null);
  const suggestions = useMemo(() => suggestMatches(state).length, [state]);
  const detected = useMemo(() => detectRecurring(state, today).length, [state, today]);
  const badge: Record<string, number> = { matching: suggestions, detected };

  return (
    <>
      <div className="head">
        <h1 className="h1">{t('planning')}</h1>
        {current.type && <button type="button" className="btn primary" onClick={() => setEditing({ type: current.type! })}><Icon name="plus" />{t(current.create!)}</button>}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === current.id} className={`tab ${x.id === current.id ? 'on' : ''}`} onClick={() => navigate(`/planning/${x.id}`)}>
            {t(x.label)}{badge[x.id] > 0 && <span className="chip warn">{badge[x.id]}</span>}
          </button>
        ))}
      </div>
      {current.id === 'recurring' && <RecurringList onEdit={(plan) => setEditing({ type: 'recurring', plan })} />}
      {current.id === 'budgets' && <BudgetList onEdit={(plan) => setEditing({ type: 'budget', plan })} />}
      {current.id === 'oneoff' && <OneoffList onEdit={(plan) => setEditing({ type: 'oneoff', plan })} />}
      {current.id === 'detected' && <RecurringSuggestions />}
      {current.id === 'matching' && <MatchList />}
      {editing && <PlanForm type={editing.type} plan={editing.plan} onClose={() => setEditing(null)} />}
    </>
  );
}

function RecurringList({ onEdit }: { onEdit: (p: Plan) => void }) {
  const { state, today, lk } = useData();
  const { t, date, money } = useSettings();
  const groups = useMemo(() => groupRecurring(state, today), [state, today]);
  const ended = useMemo(() => endedRecurring(state, today), [state, today]);
  const month = monthIndex(today);

  const cols = (
    <colgroup>
      <col /><col style={{ width: 128 }} /><col style={{ width: '13%' }} />
      <col style={{ width: '21%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} />
    </colgroup>
  );
  /** What a non-monthly plan actually charges per due date, e.g. "−240,00 € jährlich". */
  const billed = (p: Plan, on: string) => t('billedAs', { a: money(amountAt(p, on), { signed: true }), f: t(`freq${p.frequency}` as Key) });
  const monthly = (p: Plan, on: string) => (
    <>
      <Amount cents={monthlyAmount(p, on)} />
      {p.frequency > 1 && <div className="small muted num">{billed(p, on)}</div>}
    </>
  );
  const name = (p: Plan) => (
    <>
      <button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>{p.name}</button>
      {p.payeeId && <div className="small muted">{lk.payeeName(p.payeeId)}</div>}
    </>
  );
  const rows = (plans: Plan[]) => plans.map((p) => {
    const next = nextOccurrence(p, today);
    const thisMonth = occurrences(p, dateInMonth(month, 1), dateInMonth(month, 31));
    const status = thisMonth.length ? occurrenceStatus(state, p, thisMonth[0], today) : null;
    const changes = p.amounts.filter((a) => a.validFrom > today);
    return (
      <tr key={p.id} className="click" onClick={() => onEdit(p)}>
        <td>
          {name(p)}
          {changes.map((c) => (
            <div key={c.id} className="change">
              ↳ {t('fromDate', { date: date(c.validFrom) })}: <Amount cents={monthlyAmount(p, c.validFrom)} className="change" />
              {p.frequency > 1 && ` (${billed(p, c.validFrom)})`}
            </div>
          ))}
        </td>
        <td className="muted nowrap">{t(`freq${p.frequency}` as Key)}</td>
        <td className="num">{next ? date(next) : '—'}</td>
        <td className="small muted">{t('since', { date: date(p.startDate) })}{p.endDate ? ` · ${t('until', { date: date(p.endDate) })}` : ` · ${t('endless')}`}</td>
        <td>{status && <span className={`chip ${status === 'paid' ? 'ok' : status === 'overdue' ? 'warn' : ''}`}>{t(status)}</span>}</td>
        <td className="r">{monthly(p, next ?? today)}</td>
      </tr>
    );
  });
  const count = (n: number) => (n === 1 ? t('nPlans1') : t('nPlans', { n }));

  if (!groups.length && !ended.length) return <div className="card empty">{t('noPlans')}</div>;
  return (
    <div className="stack">
      {!groups.length && <div className="card empty">{t('noPlans')}</div>}
      {groups.map((g) => {
        const showSubs = g.subgroups.some((sg) => sg.category);
        return (
          <section key={g.category?.id ?? 'none'} className="card rgroup">
            <div className="rgroup-head">
              <span className="row strong"><Dot color={g.category?.color ?? '#ADB5BD'} />{g.category?.name ?? t('uncategorized')}<span className="small muted">{count(g.plans.length)}</span></span>
              <span className="small muted num">{money(g.monthly, { signed: true })} {t('perMonth')}</span>
            </div>
            <div className="tbl-wrap">
              <div className="rgroup-body">
                <table className="tbl fixed">
                  {cols}
                  <thead><tr><th>{t('name')}</th><th>{t('frequency')}</th><th>{t('next')}</th><th>{t('duration')}</th><th>{t('thisMonth')}</th><th className="r">{t('amountPerMonth')}</th></tr></thead>
                  {!showSubs && <tbody>{rows(g.plans)}</tbody>}
                </table>
                {showSubs && g.subgroups.map((sg) => (
                  <div key={sg.category?.id ?? 'direct'} className="subbox" style={{ borderLeftColor: sg.category?.color ?? 'var(--border)' }}>
                    <div className="subbox-head">
                      <span className="row">{sg.category ? <Dot color={sg.category.color} /> : null}<span className={sg.category ? 'strong' : 'muted'}>{sg.category?.name ?? t('directPlans')}</span><span className="small muted">{count(sg.plans.length)}</span></span>
                      <span className="small muted num">{t('avgPerMonth', { a: money(sg.monthly, { signed: true }) })}</span>
                    </div>
                    <table className="tbl fixed">{cols}<tbody>{rows(sg.plans)}</tbody></table>
                  </div>
                ))}
              </div>
            </div>
          </section>
        );
      })}
      {ended.length > 0 && (
        <details className="card rgroup ended-plans">
          <summary className="rgroup-head">
            <span className="row strong"><Icon name="chevron" size={16} />{t('endedPlans')}<span className="small muted">{count(ended.length)}</span></span>
          </summary>
          <div className="tbl-wrap">
            <table className="tbl fixed">
              <colgroup><col /><col style={{ width: '24%' }} /><col style={{ width: 128 }} /><col style={{ width: '19%' }} /><col style={{ width: '12%' }} /></colgroup>
              <thead><tr><th>{t('name')}</th><th>{t('category')}</th><th>{t('frequency')}</th><th>{t('duration')}</th><th className="r">{t('amountPerMonth')}</th></tr></thead>
              <tbody>
                {ended.map((p) => (
                  <tr key={p.id} className="click" onClick={() => onEdit(p)}>
                    <td>{name(p)}</td>
                    <td><CategoryChip categoryId={planCategoryId(state, p)} /></td>
                    <td className="muted nowrap">{t(`freq${p.frequency}` as Key)}</td>
                    <td className="small muted num">{date(p.startDate)} – {date(p.endDate!)}</td>
                    <td className="r">{monthly(p, p.endDate!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function BudgetList({ onEdit }: { onEdit: (p: Plan) => void }) {
  const { state, today } = useData();
  const { t, money } = useSettings();
  const plans = state.plans.filter((p) => p.type === 'budget');
  return (
    <>
      <div className="hint">{t('budgetNote')}</div>
      {!plans.length ? <div className="card empty">{t('noPlans')}</div> : (
        <div className="budgets">
          {plans.map((p) => {
            const cat = state.categories.find((c) => c.id === p.categoryId);
            const limit = -amountAt(p, today);
            const spent = cat ? spentInMonth(state, subtree(state.categories, cat.id), monthKey(today)) : 0;
            const over = spent > limit;
            return (
              <button key={p.id} type="button" className="card stack budget-card" onClick={() => onEdit(p)}>
                <div className="between">
                  <span className="row strong"><Dot color={cat?.color ?? '#999'} />{cat ? categoryLabel(state.categories, cat) : p.name}</span>
                  <span className="num muted small">{money(limit, { whole: true })} {t('perMonth')}</span>
                </div>
                <div className="prog"><span style={{ width: `${Math.min(100, (Math.max(0, spent) / Math.max(1, limit)) * 100)}%`, background: over ? 'var(--warn)' : cat?.color }} /></div>
                <div className="between small">
                  <span className="muted num">{t('spentOf', { a: money(spent), b: money(limit) })}</span>
                  <span className={`chip ${over ? 'warn' : 'ok'}`}>{over ? t('over', { a: money(spent - limit) }) : t('left', { a: money(limit - spent) })}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

function OneoffList({ onEdit }: { onEdit: (p: Plan) => void }) {
  const { state, today } = useData();
  const { t, date } = useSettings();
  const plans = state.plans.filter((p) => p.type === 'oneoff')
    .sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || a.startDate.localeCompare(b.startDate));
  if (!plans.length) return <div className="card empty">{t('noPlans')}</div>;
  return (
    <section className="card flush">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{t('dateLabel')}</th><th>{t('name')}</th><th>{t('category')}</th><th>{t('status')}</th><th className="r">{t('amount')}</th></tr></thead>
          <tbody>
            {plans.map((p) => {
              const s = oneoffStatus(p, today);
              return (
                <tr key={p.id} className="click" onClick={() => onEdit(p)} style={s === 'done' || s === 'dismissed' ? { opacity: 0.6 } : undefined}>
                  <td className="num">{date(p.startDate)}</td>
                  <td><button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); onEdit(p); }}>{p.name}</button></td>
                  <td>{p.categoryId ? <CategoryChip categoryId={p.categoryId} /> : <span className="muted">—</span>}</td>
                  <td><span className={`chip ${s === 'done' ? 'ok' : s === 'overdue' ? 'warn' : ''}`}>{t(s === 'done' ? 'linked' : s)}</span></td>
                  <td><Amount cents={amountAt(p, p.startDate)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlanForm({ type, plan, onClose }: { type: PlanType; plan?: Plan; onClose: () => void }) {
  const { state, today, mutate } = useData();
  const { t, lang, date } = useSettings();
  const base = plan ? [...plan.amounts].sort((a, b) => a.validFrom.localeCompare(b.validFrom))[0] : undefined;
  const [f, setF] = useState({
    name: plan?.name ?? '',
    payeeId: plan?.payeeId ?? null as number | null,
    categoryId: plan?.categoryId ?? null as number | null,
    frequency: plan?.frequency ?? 1,
    startDate: plan?.startDate ?? (type === 'budget' ? dateInMonth(monthIndex(today), 1) : today),
    endDate: plan?.endDate ?? '',
    sign: base ? Math.sign(base.amount) || -1 : -1,
    amount: base ? formatAmountInput(base.amount, lang) : ''
  });
  const [change, setChange] = useState({ validFrom: '', amount: '' });
  const live = plan && state.plans.find((p) => p.id === plan.id);
  const changes = live ? [...live.amounts].sort((a, b) => a.validFrom.localeCompare(b.validFrom)).slice(1) : [];
  const sign = type === 'budget' ? -1 : f.sign;

  const amount = parseAmountInput(f.amount);
  const valid = amount !== null && !!f.startDate && (type === 'budget' ? !!f.categoryId : !!f.name.trim());

  const save = () => mutate(async () => {
    const cat = state.categories.find((c) => c.id === f.categoryId);
    const body = {
      name: type === 'budget' ? (cat ? categoryLabel(state.categories, cat) : f.name) : f.name,
      payeeId: f.payeeId, categoryId: f.categoryId, frequency: f.frequency,
      startDate: f.startDate, endDate: type === 'oneoff' ? null : f.endDate || null, amount: sign * amount!
    };
    if (plan) await api('PATCH', `/plans/${plan.id}`, body);
    else await api('POST', '/plans', { type, ...body });
  }).then((ok) => ok && onClose());

  const remove = () => {
    if (plan && confirm(t('confirmDelete'))) void mutate(() => api('DELETE', `/plans/${plan.id}`)).then(onClose);
  };

  const addChange = () => {
    const a = parseAmountInput(change.amount);
    if (!plan || a === null || !change.validFrom) return;
    void mutate(() => api('POST', `/plans/${plan.id}/amounts`, { validFrom: change.validFrom, amount: sign * a })).then(() => setChange({ validFrom: '', amount: '' }));
  };

  const title = plan ? `${t('editPlan')}: ${plan.name}` : t(type === 'recurring' ? 'newRecurring' : type === 'budget' ? 'newBudget' : 'newOneoff');

  return (
    <Modal open title={title} onClose={onClose} footer={
      <>
        <div className="row">
          {plan && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" />{t('delete')}</button>}
          {plan && type === 'oneoff' && live?.status !== 'done' && (
            <button type="button" className="btn" onClick={() => mutate(() => api('PATCH', `/plans/${plan.id}`, { status: live?.status === 'dismissed' ? 'active' : 'dismissed' })).then(onClose)}>
              {t(live?.status === 'dismissed' ? 'reopen' : 'dismissPlan')}
            </button>
          )}
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!valid} onClick={save}>{t('save')}</button>
        </div>
      </>
    }>
      <div className="form">
        {type !== 'budget' && <label className="field"><span>{t('name')}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>}
        {type === 'budget' ? (
          <label className="field"><span>{t('budgetCategory')}</span><CategorySelect value={f.categoryId} onChange={(categoryId) => setF({ ...f, categoryId })} allowNone={false} kind="expense" /></label>
        ) : (
          <div className="row2">
            <label className="field"><span>{t('payee')}</span>
              <select value={f.payeeId ?? ''} onChange={(e) => setF({ ...f, payeeId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">—</option>
                {state.payees.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="field"><span>{t('category')}</span><CategorySelect value={f.categoryId} onChange={(categoryId) => setF({ ...f, categoryId })} noneLabel="—" /></label>
          </div>
        )}
        <div className="row2">
          {type !== 'budget' && (
            <label className="field"><span>{t('direction')}</span>
              <select value={f.sign} onChange={(e) => setF({ ...f, sign: Number(e.target.value) })}>
                <option value={-1}>{t('outgoing')}</option><option value={1}>{t('incoming')}</option>
              </select>
            </label>
          )}
          <label className="field"><span>{type === 'budget' ? `${t('amount')} (€ ${t('perMonth')})` : `${t('amount')} (€)`}</span>
            <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </label>
          {type === 'recurring' && (
            <label className="field"><span>{t('frequency')}</span>
              <select value={f.frequency} onChange={(e) => setF({ ...f, frequency: Number(e.target.value) })}>
                {[1, 3, 6, 12].map((x) => <option key={x} value={x}>{t(`freq${x}` as Key)}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="row2">
          <label className="field"><span>{type === 'oneoff' ? t('dateLabel') : t('start')}</span><input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          {type !== 'oneoff' && <label className="field"><span>{t('end')} ({t('endless')})</span><input type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>}
        </div>
        {plan && type !== 'oneoff' && (
          <div className="field">
            <span>{t('amountChanges')}</span>
            {changes.map((c) => (
              <div key={c.id} className="between hint" style={{ fontSize: 13 }}>
                <span>{t('fromDate', { date: date(c.validFrom) })}: <Amount cents={c.amount} /></span>
                <button type="button" className="iconbtn" aria-label={t('delete')} onClick={() => mutate(() => api('DELETE', `/plan-amounts/${c.id}`))}><Icon name="trash" size={16} /></button>
              </div>
            ))}
            <div className="row" style={{ alignItems: 'stretch' }}>
              <input type="date" aria-label={t('validFrom')} value={change.validFrom} onChange={(e) => setChange({ ...change, validFrom: e.target.value })} />
              <input inputMode="decimal" aria-label={t('amount')} placeholder={t('amount')} value={change.amount} onChange={(e) => setChange({ ...change, amount: e.target.value })} />
              <button type="button" className="btn" onClick={addChange}>{t('addChange')}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
