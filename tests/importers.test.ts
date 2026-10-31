import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseGermanAmount, parseGermanDate } from '../src/server/importers/csv';
import { detectImporter } from '../src/server/importers';

const sample = readFileSync(new URL('./fixtures/dkb-giro.csv', import.meta.url), 'utf8');

describe('csv helpers', () => {
  it('parses German amounts', () => {
    expect(parseGermanAmount('-4,48')).toBe(-448);
    expect(parseGermanAmount('2.650,00')).toBe(265000);
    expect(parseGermanAmount('1.234,5 €')).toBe(123450);
    expect(parseGermanAmount('***')).toBeNull();
  });

  it('parses two- and four-digit years', () => {
    expect(parseGermanDate('30.10.26')).toBe('2026-10-30');
    expect(parseGermanDate('1.2.2025')).toBe('2025-02-01');
    expect(parseGermanDate('foo')).toBeNull();
  });

  it('handles quoted cells with delimiters and escaped quotes', () => {
    expect(parseCsv('"a;b";"say ""hi""";c\r\nd;e;f')).toEqual([['a;b', 'say "hi"', 'c'], ['d', 'e', 'f']]);
  });
});

describe('DKB importer', () => {
  const importer = detectImporter(sample)!;
  const parsed = importer.parse(sample);

  it('is detected', () => {
    expect(importer.id).toBe('dkb-giro');
    expect(detectImporter('Datum,Betrag\n1,2')).toBeUndefined();
  });

  it('reads the balance from the header', () => {
    expect(parsed.balance).toEqual({ date: '2026-10-31', amount: 241837 });
  });

  it('takes the counterparty from the direction of the payment', () => {
    const salary = parsed.rows.find((r) => r.purpose === 'Bezuege')!;
    expect(salary.counterparty).toBe('Muster GmbH');
    expect(salary.amount).toBe(265000);
    const card = parsed.rows.find((r) => r.amount === -448)!;
    expect(card.counterparty).toBe('Netto Marken-Discount');
  });

  it('marks pending bookings and reports unreadable lines', () => {
    expect(parsed.rows.filter((r) => r.pending)).toHaveLength(1);
    expect(parsed.rows).toHaveLength(9);
    expect(parsed.errors).toEqual(['Zeile 15: Datum oder Betrag nicht lesbar']);
  });

  it('reads the quoted variant of the export', () => {
    const quoted = sample.split('\n').map((l) => l.split(';').map((c) => `"${c}"`).join(';')).join('\n');
    expect(importer.parse(quoted).rows).toHaveLength(9);
  });
});
