import { useMemo, useState } from 'react';
import type { Category, CategoryKind, MatchType, PayeeRule } from '../../shared/types';
import { CategorySelect, Dot, Icon, Modal, categoryLabel } from '../components/ui';
import { api, useData } from '../data';
import { useSettings } from '../settings';

const COLORS = ['#4C6EF5', '#12B886', '#F76707', '#AE3EC9', '#F2B705', '#15AABF', '#E64980', '#2B8A3E', '#7950F2', '#868E96'];

type CatEdit = { mode: 'new' } | { mode: 'sub'; parent: Category } | { mode: 'edit'; category: Category };

export function CategoriesPage() {
  const { state } = useData();
  const { t } = useSettings();
  const [catEdit, setCatEdit] = useState<CatEdit | null>(null);
  const [ruleEdit, setRuleEdit] = useState<{ rule?: PayeeRule } | null>(null);
  const payeeCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of state.payees) if (p.categoryId) m.set(p.categoryId, (m.get(p.categoryId) ?? 0) + 1);
    return m;
  }, [state.payees]);

  return (
    <>
      <div className="head"><h1 className="h1">{t('categories')}</h1></div>
      <div className="split">
        <section className="card split-side stack">
          <div className="between"><h2 className="h2">{t('catTree')}</h2><button type="button" className="btn sm" onClick={() => setCatEdit({ mode: 'new' })}><Icon name="plus" size={14} />{t('addCategory')}</button></div>
          <div className="tree">
            {state.categories.filter((c) => !c.parentId).map((top) => (
              <div key={top.id}>
                <div className="tcat">
                  <span className="row"><Dot color={top.color} />{top.name}{top.kind === 'income' && <span className="chip ok">{t('kindIncome')}</span>}</span>
                  <span className="tactions">
                    <button type="button" className="iconbtn" aria-label={`${t('addSub')}: ${top.name}`} onClick={() => setCatEdit({ mode: 'sub', parent: top })}><Icon name="plus" size={16} /></button>
                    <button type="button" className="iconbtn" aria-label={`${t('editCategory')}: ${top.name}`} onClick={() => setCatEdit({ mode: 'edit', category: top })}><Icon name="edit" size={16} /></button>
                  </span>
                </div>
                <div className="tsubs">
                  {state.categories.filter((c) => c.parentId === top.id).map((c) => (
                    <div key={c.id} className="tsub">
                      <span>{c.name}</span>
                      <span className="row" style={{ gap: 4 }}>
                        <span className="muted small">{t('payeesN', { n: payeeCount.get(c.id) ?? 0 })}</span>
                        <span className="tactions">
                          <button type="button" className="iconbtn" aria-label={`${t('editCategory')}: ${c.name}`} onClick={() => setCatEdit({ mode: 'edit', category: c })}><Icon name="edit" size={15} /></button>
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <div className="split-main stack" style={{ gap: 16 }}>
          <RulesCard onEdit={(rule) => setRuleEdit({ rule })} onNew={() => setRuleEdit({})} />
          <PayeesCard />
        </div>
      </div>
      {catEdit && <CategoryForm edit={catEdit} onClose={() => setCatEdit(null)} />}
      {ruleEdit && <RuleForm rule={ruleEdit.rule} onClose={() => setRuleEdit(null)} />}
    </>
  );
}

function RulesCard({ onEdit, onNew }: { onEdit: (r: PayeeRule) => void; onNew: () => void }) {
  const { state, lk } = useData();
  const { t } = useSettings();
  const rules = state.rules.filter((r) => !r.auto);
  const hits = (r: PayeeRule) => state.transactions.filter((tx) => tx.payeeId === r.payeeId).length;
  return (
    <section className="card flush">
      <div className="between" style={{ padding: '10px 10px 6px' }}>
        <div><h2 className="h2">{t('rules')}</h2><div className="small muted">{t('rulesNote')}</div></div>
        <button type="button" className="btn sm" onClick={onNew}><Icon name="plus" size={14} />{t('addRule')}</button>
      </div>
      {rules.length === 0 ? <div className="empty">—</div> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t('ruleType')}</th><th>{t('pattern')}</th><th>{t('displayName')}</th><th>{t('category')}</th><th className="r">{t('hits')}</th></tr></thead>
            <tbody>
              {rules.map((r) => {
                const payee = state.payees.find((p) => p.id === r.payeeId);
                const cat = state.categories.find((c) => c.id === payee?.categoryId);
                return (
                  <tr key={r.id} className="click" onClick={() => onEdit(r)}>
                    <td><span className="chip acc">{t(r.matchType)}</span></td>
                    <td className="small" style={{ fontFamily: 'ui-monospace, monospace' }}>{r.pattern}</td>
                    <td><button type="button" className="rowbtn" onClick={(e) => { e.stopPropagation(); onEdit(r); }}>{lk.payeeName(r.payeeId)}</button></td>
                    <td>{cat ? <span className="chip"><Dot color={cat.color} />{categoryLabel(state.categories, cat)}</span> : <span className="chip warn">{t('uncategorized')}</span>}</td>
                    <td className="r num muted">{hits(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PayeesCard() {
  const { state, mutate } = useData();
  const { t } = useSettings();
  const [onlyUncat, setOnlyUncat] = useState(true);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const tx of state.transactions) m.set(tx.payeeId, (m.get(tx.payeeId) ?? 0) + 1);
    return m;
  }, [state.transactions]);
  const payees = state.payees.filter((p) => (counts.get(p.id) ?? 0) > 0 && (!onlyUncat || !p.categoryId))
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0));
  return (
    <section className="card flush">
      <div className="between" style={{ padding: '10px 10px 6px' }}>
        <div><h2 className="h2">{t('payeesTitle')}</h2><div className="small muted">{t('payeesNote')}</div></div>
        <label className="check small"><input type="checkbox" checked={onlyUncat} onChange={(e) => setOnlyUncat(e.target.checked)} />{t('onlyUncategorized')}</label>
      </div>
      {payees.length === 0 ? <div className="empty">—</div> : (
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>
              {payees.map((p) => (
                <tr key={p.id}>
                  <td className="strong">{p.name}<div className="small muted">{t('txN', { n: counts.get(p.id) ?? 0 })}</div></td>
                  <td style={{ width: '45%' }}>
                    <CategorySelect value={p.categoryId} onChange={(categoryId) => mutate(() => api('PATCH', `/payees/${p.id}`, { categoryId }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CategoryForm({ edit, onClose }: { edit: CatEdit; onClose: () => void }) {
  const { state, mutate } = useData();
  const { t } = useSettings();
  const existing = edit.mode === 'edit' ? edit.category : undefined;
  const isMain = edit.mode === 'new' || (edit.mode === 'edit' && !edit.category.parentId);
  const [name, setName] = useState(existing?.name ?? '');
  const [color, setColor] = useState(existing?.color ?? COLORS.find((c) => !state.categories.some((x) => x.color === c)) ?? COLORS[0]);
  const [kind, setKind] = useState<CategoryKind>(existing?.kind ?? 'expense');

  const save = () => mutate(() => existing
    ? api('PATCH', `/categories/${existing.id}`, isMain ? { name, color, kind } : { name })
    : api('POST', '/categories', { name, color, kind, parentId: edit.mode === 'sub' ? edit.parent.id : null })
  ).then((ok) => ok && onClose());

  const remove = () => {
    if (existing && confirm(t('deleteCategoryConfirm', { name: existing.name }))) void mutate(() => api('DELETE', `/categories/${existing.id}`)).then(onClose);
  };

  const title = edit.mode === 'new' ? t('newCategory') : edit.mode === 'sub' ? t('newSub', { name: edit.parent.name }) : t('editCategory');
  return (
    <Modal open title={title} onClose={onClose} footer={
      <>
        <div>{existing && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" />{t('delete')}</button>}</div>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!name.trim()} onClick={save}>{t('save')}</button>
        </div>
      </>
    }>
      <div className="form">
        <label className="field"><span>{t('name')}</span><input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} /></label>
        {isMain && (
          <>
            <div className="field">
              <span>{t('color')}</span>
              <div className="swatches" role="radiogroup" aria-label={t('color')}>
                {COLORS.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={c === color} aria-label={c} className={`swatch ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />
                ))}
              </div>
            </div>
            <label className="field"><span>{t('kind')}</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
                <option value="expense">{t('kindExpense')}</option><option value="income">{t('kindIncome')}</option>
              </select>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

function RuleForm({ rule, onClose }: { rule?: PayeeRule; onClose: () => void }) {
  const { state, mutate } = useData();
  const { t } = useSettings();
  const payee = rule && state.payees.find((p) => p.id === rule.payeeId);
  const [f, setF] = useState({ matchType: rule?.matchType ?? 'starts' as MatchType, pattern: rule?.pattern ?? '', name: payee?.name ?? '', categoryId: payee?.categoryId ?? null as number | null });
  const save = () => mutate(() => rule ? api('PUT', `/rules/${rule.id}`, f) : api('POST', '/rules', f)).then((ok) => ok && onClose());
  const remove = () => { if (rule && confirm(t('confirmDelete'))) void mutate(() => api('DELETE', `/rules/${rule.id}`)).then(onClose); };
  return (
    <Modal open title={rule ? t('editRule') : t('newRule')} onClose={onClose} footer={
      <>
        <div>{rule && <button type="button" className="btn danger" onClick={remove}><Icon name="trash" />{t('delete')}</button>}</div>
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!f.pattern.trim() || !f.name.trim()} onClick={save}>{t('save')}</button>
        </div>
      </>
    }>
      <div className="form">
        <div className="row2">
          <label className="field"><span>{t('ruleType')}</span>
            <select value={f.matchType} onChange={(e) => setF({ ...f, matchType: e.target.value as MatchType })}>
              <option value="exact">{t('exact')}</option><option value="starts">{t('starts')}</option><option value="contains">{t('contains')}</option>
            </select>
          </label>
          <label className="field"><span>{t('pattern')}</span><input value={f.pattern} autoFocus onChange={(e) => setF({ ...f, pattern: e.target.value })} /></label>
        </div>
        <label className="field"><span>{t('displayName')}</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>{t('category')}</span><CategorySelect value={f.categoryId} onChange={(categoryId) => setF({ ...f, categoryId })} /></label>
      </div>
    </Modal>
  );
}
