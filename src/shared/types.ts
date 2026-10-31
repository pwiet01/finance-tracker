// All amounts are integer cents. All dates are ISO strings (YYYY-MM-DD).

export type MatchType = 'exact' | 'starts' | 'contains';
export type CategoryKind = 'expense' | 'income';
export type PlanType = 'recurring' | 'budget' | 'oneoff';
export type PlanStatus = 'active' | 'done' | 'dismissed';

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
  color: string;
  kind: CategoryKind;
}

export interface Payee {
  id: number;
  name: string;
  categoryId: number | null;
}

export interface PayeeRule {
  id: number;
  matchType: MatchType;
  pattern: string;
  payeeId: number;
  /** Created automatically on import for an unknown counterparty. */
  auto: boolean;
}

export interface Transaction {
  id: number;
  date: string;
  valueDate: string | null;
  amount: number;
  rawPayee: string;
  purpose: string;
  iban: string | null;
  type: string | null;
  payeeId: number;
  importId: number | null;
}

export interface PlanAmount {
  id: number;
  validFrom: string;
  amount: number;
}

/**
 * recurring: due every `frequency` months on the day of `startDate`.
 * budget:    estimated monthly spending of a category (amount is negative).
 * oneoff:    single expected payment or credit on `startDate`.
 */
export interface Plan {
  id: number;
  type: PlanType;
  name: string;
  payeeId: number | null;
  categoryId: number | null;
  frequency: number;
  startDate: string;
  endDate: string | null;
  status: PlanStatus;
  amounts: PlanAmount[];
}

export interface PlanMatch {
  id: number;
  planId: number;
  transactionId: number;
  /** Date of the plan occurrence this transaction settles. */
  period: string;
}

export interface Dismissal {
  planId: number;
  transactionId: number;
}

export interface Balance {
  date: string;
  amount: number;
}

export interface AppState {
  categories: Category[];
  payees: Payee[];
  rules: PayeeRule[];
  transactions: Transaction[];
  plans: Plan[];
  matches: PlanMatch[];
  dismissals: Dismissal[];
  balance: Balance | null;
}

export interface ImportPreviewRow {
  date: string;
  amount: number;
  rawPayee: string;
  payeeName: string;
  purpose: string;
  status: 'new' | 'duplicate' | 'pending';
  ruleApplied: boolean;
}

export interface ImportPreview {
  format: { id: string; name: string };
  balance: Balance | null;
  rows: ImportPreviewRow[];
  errors: string[];
}

export interface ImportResult {
  importId: number;
  inserted: number;
  transactionIds: number[];
}
