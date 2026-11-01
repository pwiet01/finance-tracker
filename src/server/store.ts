import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { resolveRule, ruleMatches } from '../shared/rules';
import type {
  AppState, Category, CategoryKind, ImportPreview, ImportResult, MatchType, Payee, PayeeRule, PlanStatus, PlanType, RecurringPlanInput
} from '../shared/types';
import { detectImporter, type Importer, type ParsedRow } from './importers';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

type Row = Record<string, any>;

export interface RuleInput {
  id?: number;
  matchType: MatchType;
  pattern: string;
  /** Text the purpose must contain; empty = any purpose. */
  purpose?: string;
  name: string;
  categoryId?: number | null;
  mixed?: boolean;
}

export interface PlanInput {
  type: PlanType;
  name: string;
  payeeId?: number | null;
  categoryId?: number | null;
  frequency?: number;
  startDate: string;
  endDate?: string | null;
  amount: number;
}

/** All database access. Every write method leaves the data consistent on its own. */
export class Store {
  constructor(private db: DatabaseSync) {}

  private all(sql: string, ...params: any[]): Row[] { return this.db.prepare(sql).all(...params) as Row[]; }
  private get(sql: string, ...params: any[]): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  private run(sql: string, ...params: any[]) { return this.db.prepare(sql).run(...params); }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  // ---------- read ----------

  state(): AppState {
    const amounts = this.all('SELECT id, plan_id, valid_from, amount FROM plan_amounts ORDER BY valid_from');
    const balance = this.get('SELECT date, amount FROM balances ORDER BY date DESC LIMIT 1');
    return {
      categories: this.all('SELECT * FROM categories ORDER BY parent_id IS NOT NULL, id').map((r) => ({
        id: r.id, name: r.name, parentId: r.parent_id, color: r.color, kind: r.kind
      })),
      payees: this.payees(),
      rules: this.rules(),
      transactions: this.all('SELECT * FROM transactions ORDER BY date DESC, id DESC').map((r) => ({
        id: r.id, date: r.date, valueDate: r.value_date, amount: r.amount, rawPayee: r.raw_payee, purpose: r.purpose,
        iban: r.iban, type: r.type, payeeId: r.payee_id, categoryId: r.category_id, importId: r.import_id
      })),
      plans: this.all('SELECT * FROM plans ORDER BY id').map((r) => ({
        id: r.id, type: r.type, name: r.name, payeeId: r.payee_id, categoryId: r.category_id, frequency: r.frequency,
        startDate: r.start_date, endDate: r.end_date, status: r.status,
        amounts: amounts.filter((a) => a.plan_id === r.id).map((a) => ({ id: a.id, validFrom: a.valid_from, amount: a.amount }))
      })),
      matches: this.all('SELECT * FROM plan_matches').map((r) => ({ id: r.id, planId: r.plan_id, transactionId: r.transaction_id, period: r.period })),
      dismissals: this.all('SELECT * FROM dismissals').map((r) => ({ planId: r.plan_id, transactionId: r.transaction_id })),
      ignoredRecurring: this.all('SELECT key FROM recurring_ignores ORDER BY key').map((r) => r.key as string),
      balance: balance ? { date: balance.date, amount: balance.amount } : null
    };
  }

  private payees(): Payee[] {
    return this.all('SELECT * FROM payees ORDER BY name COLLATE NOCASE').map((r) => ({
      id: r.id, name: r.name, categoryId: r.category_id, mixed: !!r.mixed
    }));
  }

  private rules(): PayeeRule[] {
    return this.all('SELECT * FROM payee_rules ORDER BY id').map((r) => ({
      id: r.id, matchType: r.match_type, pattern: r.pattern, purpose: r.purpose, payeeId: r.payee_id, auto: !!r.auto
    }));
  }

  // ---------- import ----------

  private readFile(text: string): { importer: Importer; rows: (ParsedRow & { hash: string })[]; preview: ImportPreview } {
    const importer = detectImporter(text);
    if (!importer) throw new HttpError(400, 'unknown_format');
    const parsed = importer.parse(text);
    const seen = new Map<string, number>();
    const rows = parsed.rows.map((r) => {
      // Identical bookings within one file get a running number so they stay distinct.
      const base = [r.date, r.amount, r.counterparty, r.purpose, r.iban ?? ''].join('|');
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...r, hash: createHash('sha256').update(`${base}#${n}`).digest('hex') };
    });
    const existing = new Set(this.all('SELECT hash FROM transactions').map((r) => r.hash as string));
    const rules = this.rules();
    const payees = new Map(this.payees().map((p) => [p.id, p.name]));
    const preview: ImportPreview = {
      format: { id: importer.id, name: importer.name },
      balance: parsed.balance,
      errors: parsed.errors,
      rows: rows.map((r) => {
        const rule = resolveRule(r.counterparty, r.purpose, rules);
        return {
          date: r.date, amount: r.amount, rawPayee: r.counterparty, purpose: r.purpose,
          payeeName: rule ? payees.get(rule.payeeId) ?? r.counterparty : r.counterparty,
          ruleApplied: !!rule && !rule.auto,
          status: r.pending ? 'pending' : existing.has(r.hash) ? 'duplicate' : 'new'
        };
      })
    };
    return { importer, rows, preview };
  }

  previewImport(text: string): ImportPreview {
    return this.readFile(text).preview;
  }

  commitImport(text: string, filename: string | null): ImportResult {
    const { importer, rows, preview } = this.readFile(text);
    return this.tx(() => {
      const fresh = rows.filter((_, i) => preview.rows[i].status === 'new');
      const importId = Number(this.run(
        'INSERT INTO imports (filename, format, imported_at, inserted) VALUES (?, ?, ?, ?)',
        filename, importer.id, new Date().toISOString(), fresh.length
      ).lastInsertRowid);
      const insert = this.db.prepare(`INSERT INTO transactions
        (date, value_date, amount, raw_payee, purpose, iban, type, hash, payee_id, import_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const rules = this.rules();
      const ids = fresh.map((r) => Number(insert.run(
        r.date, r.valueDate, r.amount, r.counterparty, r.purpose, r.iban, r.type, r.hash, this.payeeFor(r.counterparty, r.purpose, rules), importId
      ).lastInsertRowid));
      if (preview.balance) {
        this.run('INSERT INTO balances (date, amount) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET amount = excluded.amount',
          preview.balance.date, preview.balance.amount);
      }
      return { importId, inserted: ids.length, transactionIds: ids };
    });
  }

  // ---------- payees & rules ----------

  private ensurePayee(name: string): number {
    const clean = name.trim();
    if (!clean) throw new HttpError(400, 'name_required');
    const row = this.get('SELECT id FROM payees WHERE name = ?', clean);
    return row ? row.id : Number(this.run('INSERT INTO payees (name) VALUES (?)', clean).lastInsertRowid);
  }

  /**
   * Payee for a booking; unknown names get their own payee and an automatic exact rule.
   * `rules` is the current rule list and receives any automatic rule created here.
   */
  private payeeFor(raw: string, purpose: string, rules: PayeeRule[]): number {
    const rule = resolveRule(raw, purpose, rules);
    if (rule) return rule.payeeId;
    const payeeId = this.ensurePayee(raw || '—');
    const id = Number(this.run('INSERT INTO payee_rules (match_type, pattern, payee_id, auto) VALUES (?, ?, ?, 1)', 'exact', raw, payeeId).lastInsertRowid);
    rules.push({ id, matchType: 'exact', pattern: raw, purpose: '', payeeId, auto: true });
    return payeeId;
  }

  /** Re-applies all rules to all transactions and removes payees nothing refers to any more. */
  private reresolve() {
    const rules = this.rules();
    const update = this.db.prepare('UPDATE transactions SET payee_id = ? WHERE id = ?');
    for (const t of this.all('SELECT id, raw_payee, purpose, payee_id FROM transactions')) {
      const payeeId = this.payeeFor(t.raw_payee, t.purpose, rules);
      if (payeeId !== t.payee_id) update.run(payeeId, t.id);
    }
    this.run(`DELETE FROM payees WHERE id NOT IN (SELECT payee_id FROM transactions)
      AND id NOT IN (SELECT payee_id FROM payee_rules) AND id NOT IN (SELECT payee_id FROM plans WHERE payee_id IS NOT NULL)`);
  }

  saveRule(input: RuleInput): { payeeId: number } {
    return this.tx(() => {
      const payeeId = this.writeRule(input);
      this.reresolve();
      return { payeeId };
    });
  }

  /** Several rules at once, e.g. to merge many raw names into one payee; resolves only once. */
  saveRules(list: RuleInput[]): { payeeIds: number[] } {
    return this.tx(() => {
      const payeeIds = list.map((r) => this.writeRule(r));
      this.reresolve();
      return { payeeIds };
    });
  }

  private writeRule(input: RuleInput): number {
    const pattern = input.pattern.trim();
    const purpose = input.purpose?.trim() ?? '';
    if (!pattern) throw new HttpError(400, 'pattern_required');
    const payeeId = this.ensurePayee(input.name);
    this.setPayeeCategory(payeeId, input);
    if (input.id) this.run('DELETE FROM payee_rules WHERE id = ?', input.id);
    this.run(`INSERT INTO payee_rules (match_type, pattern, purpose, payee_id, auto) VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(match_type, pattern, purpose) DO UPDATE SET payee_id = excluded.payee_id, auto = 0`, input.matchType, pattern, purpose, payeeId);
    // Automatic rules covered by the new rule would otherwise keep the old names alive.
    // A rule that also checks the purpose covers only some bookings of a name, so those stay.
    if (!purpose) {
      for (const r of this.rules().filter((r) => r.auto && ruleMatches(input.matchType, pattern, r.pattern))) {
        this.run('DELETE FROM payee_rules WHERE id = ?', r.id);
      }
    }
    return payeeId;
  }

  deleteRule(id: number) {
    this.tx(() => {
      this.run('DELETE FROM payee_rules WHERE id = ?', id);
      this.reresolve();
    });
  }

  /** A payee either has a default category or is mixed; setting one clears the other. */
  private setPayeeCategory(id: number, input: { categoryId?: number | null; mixed?: boolean }) {
    if (input.mixed) this.run('UPDATE payees SET mixed = 1, category_id = NULL WHERE id = ?', id);
    else if (input.categoryId !== undefined) this.run('UPDATE payees SET category_id = ?, mixed = 0 WHERE id = ?', input.categoryId, id);
    else if (input.mixed === false) this.run('UPDATE payees SET mixed = 0 WHERE id = ?', id);
  }

  updatePayee(id: number, input: { name?: string; categoryId?: number | null; mixed?: boolean }) {
    this.tx(() => {
      this.setPayeeCategory(id, input);
      const name = input.name?.trim();
      if (!name) return;
      const other = this.get('SELECT id FROM payees WHERE name = ? AND id != ?', name, id);
      if (!other) {
        this.run('UPDATE payees SET name = ? WHERE id = ?', name, id);
        return;
      }
      // Renaming onto an existing name merges both payees.
      for (const table of ['payee_rules', 'transactions', 'plans']) {
        this.run(`UPDATE ${table} SET payee_id = ? WHERE payee_id = ?`, other.id, id);
      }
      this.run('DELETE FROM payees WHERE id = ?', id);
    });
  }

  /** Sets the category of several payees at once. */
  updatePayees(ids: number[], categoryId: number | null) {
    this.tx(() => {
      for (const id of ids) this.setPayeeCategory(id, { categoryId });
    });
  }

  /** Sets (or with null, removes) the own category of single bookings, independent of their payee. */
  updateTransactions(ids: number[], categoryId: number | null) {
    this.tx(() => {
      for (const id of ids) this.run('UPDATE transactions SET category_id = ? WHERE id = ?', categoryId, id);
    });
  }

  // ---------- categories ----------

  createCategory(input: { name: string; parentId?: number | null; color: string; kind?: CategoryKind }): Category {
    const parent = input.parentId ? this.get('SELECT * FROM categories WHERE id = ?', input.parentId) : undefined;
    if (input.parentId && !parent) throw new HttpError(404, 'category_not_found');
    if (parent?.parent_id) throw new HttpError(400, 'max_two_levels');
    const kind = parent ? parent.kind : input.kind ?? 'expense';
    const color = parent ? parent.color : input.color;
    const id = Number(this.run('INSERT INTO categories (name, parent_id, color, kind) VALUES (?, ?, ?, ?)',
      input.name.trim(), input.parentId ?? null, color, kind).lastInsertRowid);
    return { id, name: input.name.trim(), parentId: input.parentId ?? null, color, kind };
  }

  updateCategory(id: number, input: { name?: string; color?: string; kind?: CategoryKind }) {
    this.tx(() => {
      if (input.name?.trim()) this.run('UPDATE categories SET name = ? WHERE id = ?', input.name.trim(), id);
      // Colour and kind belong to the main category and are inherited by its subcategories.
      if (input.color) this.run('UPDATE categories SET color = ? WHERE id = ? OR parent_id = ?', input.color, id, id);
      if (input.kind) this.run('UPDATE categories SET kind = ? WHERE id = ? OR parent_id = ?', input.kind, id, id);
    });
  }

  deleteCategory(id: number) {
    this.tx(() => {
      // Budgets cannot exist without their category.
      this.run(`DELETE FROM plans WHERE type = 'budget' AND category_id IN
        (SELECT id FROM categories WHERE id = ? OR parent_id = ?)`, id, id);
      this.run('DELETE FROM categories WHERE id = ?', id);
    });
  }

  // ---------- plans ----------

  createPlan(input: PlanInput): number {
    if (input.type === 'budget' && !input.categoryId) throw new HttpError(400, 'budget_needs_category');
    if (!input.name?.trim()) throw new HttpError(400, 'name_required');
    return this.tx(() => this.createPlanRow(input));
  }

  private createPlanRow(input: PlanInput): number {
    if (!input.name?.trim()) throw new HttpError(400, 'name_required');
    const id = Number(this.run(`INSERT INTO plans (type, name, payee_id, category_id, frequency, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, input.type, input.name.trim(), input.payeeId ?? null, input.categoryId ?? null,
      input.frequency ?? 1, input.startDate, input.endDate ?? null).lastInsertRowid);
    this.run('INSERT INTO plan_amounts (plan_id, valid_from, amount) VALUES (?, ?, ?)', id, input.startDate, input.amount);
    return id;
  }

  updatePlan(id: number, input: Partial<Omit<PlanInput, 'type' | 'amount'>> & { status?: PlanStatus; amount?: number }) {
    const plan = this.get('SELECT * FROM plans WHERE id = ?', id);
    if (!plan) throw new HttpError(404, 'plan_not_found');
    if (plan.type === 'budget' && input.categoryId === null) throw new HttpError(400, 'budget_needs_category');
    this.tx(() => {
      const cols: [string, unknown][] = [
        ['name', input.name?.trim()], ['payee_id', input.payeeId], ['category_id', input.categoryId], ['frequency', input.frequency],
        ['start_date', input.startDate], ['end_date', input.endDate], ['status', input.status]
      ];
      for (const [col, value] of cols) if (value !== undefined) this.run(`UPDATE plans SET ${col} = ? WHERE id = ?`, value, id);
      if (input.startDate) {
        // The first amount always starts with the plan.
        this.run(`UPDATE plan_amounts SET valid_from = ? WHERE id =
          (SELECT id FROM plan_amounts WHERE plan_id = ? ORDER BY valid_from LIMIT 1)`, input.startDate, id);
      }
      if (input.amount !== undefined) {
        this.run('UPDATE plan_amounts SET amount = ? WHERE id = (SELECT id FROM plan_amounts WHERE plan_id = ? ORDER BY valid_from LIMIT 1)', input.amount, id);
      }
    });
  }

  /**
   * Creates recurring plans with their amount history and links past bookings in one go.
   * A payee without category takes over the plan's category.
   */
  createRecurringPlans(list: RecurringPlanInput[]): number[] {
    return this.tx(() => list.map((input) => {
      if (!input.amounts.length) throw new HttpError(400, 'amount_required');
      const [first, ...changes] = [...input.amounts].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      const id = this.createPlanRow({ ...input, type: 'recurring', startDate: input.startDate, amount: first.amount });
      for (const a of changes) this.addPlanAmount(id, a.validFrom, a.amount);
      for (const m of input.matches) {
        this.run(`INSERT INTO plan_matches (plan_id, transaction_id, period) VALUES (?, ?, ?)
          ON CONFLICT(transaction_id) DO UPDATE SET plan_id = excluded.plan_id, period = excluded.period`, id, m.transactionId, m.period);
      }
      if (input.categoryId) this.run('UPDATE payees SET category_id = ? WHERE id = ? AND category_id IS NULL AND mixed = 0', input.categoryId, input.payeeId);
      return id;
    }));
  }

  ignoreRecurring(key: string) { this.run('INSERT OR IGNORE INTO recurring_ignores (key) VALUES (?)', key); }
  unignoreRecurring(key: string) { this.run('DELETE FROM recurring_ignores WHERE key = ?', key); }

  deletePlan(id: number) { this.run('DELETE FROM plans WHERE id = ?', id); }

  addPlanAmount(planId: number, validFrom: string, amount: number) {
    this.run(`INSERT INTO plan_amounts (plan_id, valid_from, amount) VALUES (?, ?, ?)
      ON CONFLICT(plan_id, valid_from) DO UPDATE SET amount = excluded.amount`, planId, validFrom, amount);
  }

  deletePlanAmount(id: number) {
    const row = this.get('SELECT plan_id FROM plan_amounts WHERE id = ?', id);
    if (!row) return;
    const { n } = this.get('SELECT COUNT(*) AS n FROM plan_amounts WHERE plan_id = ?', row.plan_id)!;
    if (n <= 1) throw new HttpError(400, 'last_amount');
    this.run('DELETE FROM plan_amounts WHERE id = ?', id);
  }

  // ---------- matching ----------

  addMatches(list: { planId: number; transactionId: number; period: string }[]) {
    this.tx(() => {
      for (const m of list) {
        this.run(`INSERT INTO plan_matches (plan_id, transaction_id, period) VALUES (?, ?, ?)
          ON CONFLICT(transaction_id) DO UPDATE SET plan_id = excluded.plan_id, period = excluded.period`, m.planId, m.transactionId, m.period);
        this.run(`UPDATE plans SET status = 'done' WHERE id = ? AND type = 'oneoff'`, m.planId);
      }
    });
  }

  removeMatch(id: number) {
    this.tx(() => {
      const row = this.get('SELECT plan_id FROM plan_matches WHERE id = ?', id);
      this.run('DELETE FROM plan_matches WHERE id = ?', id);
      if (row) this.run(`UPDATE plans SET status = 'active' WHERE id = ? AND type = 'oneoff' AND status = 'done'`, row.plan_id);
    });
  }

  dismiss(planId: number, transactionId: number) {
    this.run('INSERT OR IGNORE INTO dismissals (plan_id, transaction_id) VALUES (?, ?)', planId, transactionId);
  }

  undismiss(planId: number, transactionId: number) {
    this.run('DELETE FROM dismissals WHERE plan_id = ? AND transaction_id = ?', planId, transactionId);
  }
}
