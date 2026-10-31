import { parseCsv, parseGermanAmount, parseGermanDate } from './csv';
import type { Importer, ParsedRow } from './types';

// DKB Girokonto export (format since 2023): a few header lines with the account
// and balance, then a semicolon table.
const COL = {
  date: 'Buchungsdatum',
  valueDate: 'Wertstellung',
  status: 'Status',
  payer: 'Zahlungspflichtige*r',
  payee: 'Zahlungsempfänger*in',
  purpose: 'Verwendungszweck',
  type: 'Umsatztyp',
  iban: 'IBAN',
  amount: 'Betrag (€)'
} as const;

export const dkb: Importer = {
  id: 'dkb-giro',
  name: 'DKB Girokonto',

  detect(text) {
    const head = text.slice(0, 4000);
    return head.includes(COL.date) && head.includes(COL.payee) && head.includes(COL.amount);
  },

  parse(text) {
    const lines = parseCsv(text);
    const errors: string[] = [];
    let balance = null;

    const headerIdx = lines.findIndex((l) => l.includes(COL.date) && l.includes(COL.amount));
    for (const l of lines.slice(0, Math.max(headerIdx, 0))) {
      const m = l[0]?.match(/^Kontostand vom (\d{1,2}\.\d{1,2}\.\d{2,4})/);
      const date = m ? parseGermanDate(m[1]) : null;
      const amount = m ? parseGermanAmount(l[1] ?? '') : null;
      if (date && amount !== null) balance = { date, amount };
    }
    if (headerIdx < 0) return { balance, rows: [], errors: ['Kopfzeile nicht gefunden'] };

    const header = lines[headerIdx];
    const col = (name: string) => header.indexOf(name);
    const idx = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, col(v)])) as Record<keyof typeof COL, number>;
    const get = (l: string[], i: number) => (i >= 0 ? (l[i] ?? '').trim() : '');

    const rows: ParsedRow[] = [];
    lines.slice(headerIdx + 1).forEach((l, n) => {
      if (l.every((c) => c.trim() === '')) return;
      const lineNo = headerIdx + n + 2;
      const date = parseGermanDate(get(l, idx.date));
      const amount = parseGermanAmount(get(l, idx.amount));
      if (!date || amount === null) {
        errors.push(`Zeile ${lineNo}: Datum oder Betrag nicht lesbar`);
        return;
      }
      const outgoing = amount < 0;
      const counterparty = (outgoing ? get(l, idx.payee) : get(l, idx.payer)) || get(l, outgoing ? idx.payer : idx.payee);
      rows.push({
        date,
        valueDate: parseGermanDate(get(l, idx.valueDate)),
        amount,
        counterparty,
        purpose: get(l, idx.purpose),
        iban: get(l, idx.iban) || null,
        type: get(l, idx.type) || null,
        pending: get(l, idx.status).toLowerCase().startsWith('vorgemerkt')
      });
    });
    return { balance, rows, errors };
  }
};
