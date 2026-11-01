import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_CATEGORIES: [name: string, color: string, kind: 'expense' | 'income', subs: string[]][] = [
  ['Wohnen', '#4C6EF5', 'expense', ['Miete', 'Strom & Gas', 'Internet & Telefon']],
  ['Lebensmittel', '#12B886', 'expense', ['Supermarkt', 'Bäckerei & Café']],
  ['Mobilität', '#F76707', 'expense', ['ÖPNV', 'Bahn & Fernverkehr', 'Auto']],
  ['Shopping', '#AE3EC9', 'expense', ['Online', 'Kleidung', 'Haushalt']],
  ['Freizeit', '#F2B705', 'expense', ['Restaurants', 'Sport', 'Kultur']],
  ['Abos & Verträge', '#15AABF', 'expense', ['Streaming', 'Cloud & Software', 'Versicherungen', 'Gebühren']],
  ['Einnahmen', '#2B8A3E', 'income', ['Gehalt', 'Erstattungen']]
];

const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  (db) => {
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        color TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'expense'
      );
      CREATE TABLE payees (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
      );
      CREATE TABLE payee_rules (
        id INTEGER PRIMARY KEY,
        match_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        payee_id INTEGER NOT NULL REFERENCES payees(id) ON DELETE CASCADE,
        auto INTEGER NOT NULL DEFAULT 0,
        UNIQUE (match_type, pattern)
      );
      CREATE TABLE imports (
        id INTEGER PRIMARY KEY,
        filename TEXT,
        format TEXT NOT NULL,
        imported_at TEXT NOT NULL,
        inserted INTEGER NOT NULL
      );
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        value_date TEXT,
        amount INTEGER NOT NULL,
        raw_payee TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT '',
        iban TEXT,
        type TEXT,
        hash TEXT NOT NULL UNIQUE,
        payee_id INTEGER NOT NULL REFERENCES payees(id),
        import_id INTEGER REFERENCES imports(id)
      );
      CREATE INDEX transactions_date ON transactions(date);
      CREATE TABLE balances (
        date TEXT PRIMARY KEY,
        amount INTEGER NOT NULL
      );
      CREATE TABLE plans (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        payee_id INTEGER REFERENCES payees(id) ON DELETE SET NULL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        frequency INTEGER NOT NULL DEFAULT 1,
        start_date TEXT NOT NULL,
        end_date TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      );
      CREATE TABLE plan_amounts (
        id INTEGER PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        valid_from TEXT NOT NULL,
        amount INTEGER NOT NULL,
        UNIQUE (plan_id, valid_from)
      );
      CREATE TABLE plan_matches (
        id INTEGER PRIMARY KEY,
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
        period TEXT NOT NULL
      );
      CREATE TABLE dismissals (
        plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        PRIMARY KEY (plan_id, transaction_id)
      );
    `);
    const insert = db.prepare('INSERT INTO categories (name, parent_id, color, kind) VALUES (?, ?, ?, ?)');
    for (const [name, color, kind, subs] of DEFAULT_CATEGORIES) {
      const parent = Number(insert.run(name, null, color, kind).lastInsertRowid);
      for (const sub of subs) insert.run(sub, parent, color, kind);
    }
  },
  (db) => {
    db.exec('CREATE TABLE recurring_ignores (key TEXT PRIMARY KEY)');
  },
  (db) => {
    // Per-booking categories, payees without a default category, and rules that also look at the purpose.
    db.exec(`
      ALTER TABLE transactions ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL;
      ALTER TABLE payees ADD COLUMN mixed INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE payee_rules_new (
        id INTEGER PRIMARY KEY,
        match_type TEXT NOT NULL,
        pattern TEXT NOT NULL,
        purpose TEXT NOT NULL DEFAULT '',
        payee_id INTEGER NOT NULL REFERENCES payees(id) ON DELETE CASCADE,
        auto INTEGER NOT NULL DEFAULT 0,
        UNIQUE (match_type, pattern, purpose)
      );
      INSERT INTO payee_rules_new (id, match_type, pattern, payee_id, auto) SELECT id, match_type, pattern, payee_id, auto FROM payee_rules;
      DROP TABLE payee_rules;
      ALTER TABLE payee_rules_new RENAME TO payee_rules;
    `);
  }
];

export function openDb(file = process.env.FT_DB ?? 'data/finance.db'): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      MIGRATIONS[v](db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}
