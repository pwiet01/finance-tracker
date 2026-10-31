// Small helpers shared by the bank importers.

/** Splits CSV text into rows of cells. Handles quoted cells, escaped quotes and CRLF. */
export function parseCsv(text: string, delimiter = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** "1.234,56", "-4,48", "1.234,56 €" → cents. Returns null when not a number. */
export function parseGermanAmount(s: string): number | null {
  const clean = s.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** "30.10.26" or "30.10.2026" → "2026-10-30". Returns null when not a date. */
export function parseGermanDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
