import type { Balance } from '../../shared/types';

/** One booking as read from a bank file, before it touches the database. */
export interface ParsedRow {
  date: string;
  valueDate: string | null;
  /** Integer cents, negative for outgoing payments. */
  amount: number;
  /** The other party: recipient for outgoing, sender for incoming payments. */
  counterparty: string;
  purpose: string;
  iban: string | null;
  type: string | null;
  /** Not yet booked ("vorgemerkt"); skipped on import. */
  pending: boolean;
}

export interface ParsedFile {
  balance: Balance | null;
  rows: ParsedRow[];
  /** Human-readable problems with single lines; the rest of the file is still used. */
  errors: string[];
}

/**
 * A bank format. To support another bank, add a module implementing this
 * interface and register it in `importers/index.ts`.
 */
export interface Importer {
  id: string;
  name: string;
  /** Cheap check whether the file text looks like this format. */
  detect(text: string): boolean;
  parse(text: string): ParsedFile;
}
