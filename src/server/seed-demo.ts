// Builds a demo database with twelve months of invented bookings, written as a
// DKB export and imported through the normal importer. Used for screenshots and trying things out.
import { rmSync } from 'node:fs';
import { dateInMonth, monthEnd, monthIndex, todayIso } from '../shared/dates';
import { suggestMatches } from '../shared/matching';
import { openDb } from './db';
import { Store } from './store';

const file = process.env.FT_DB ?? 'data/demo.db';
if (!file.includes('demo')) throw new Error('Refusing to overwrite a database that is not a demo database');
for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });

const store = new Store(openDb(file));
const today = todayIso();
const now = monthIndex(today);

let seed = 7;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
};
const between = (a: number, b: number) => Math.round((a + rand() * (b - a)) * 100);

interface Row { date: string; payee: string; purpose: string; amount: number; pending?: boolean }
const rows: Row[] = [];
const add = (date: string, payee: string, purpose: string, amount: number) => { if (date <= today) rows.push({ date, payee, purpose, amount }); };

for (let m = now - 11; m <= now; m++) {
  const d = (day: number) => dateInMonth(m, day);
  const month = m % 12;
  add(d(28), 'Muster GmbH', 'Bezuege', 265000);
  add(d(1), 'Hausverwaltung Beispiel KG', 'Miete', -85000);
  add(d(1), 'DB Vertrieb GmbH', 'Deutschlandticket', -5800);
  add(d(3), 'FITNESSPARK GMBH', 'Mitgliedsbeitrag', -3500);
  if (m !== now) add(d(5), 'Mobilfunk Beispiel AG', 'Rechnung Mobilfunk', -1400);
  add(d(12), 'STREAMLY GMBH', 'Abo Premium', -1399);
  add(d(15), 'Stadtwerke Musterstadt', 'Abschlag Strom', m === now ? -7200 : -6500);
  add(d(23), 'Vodafone GmbH', 'Ihre Rechnung Kabel', -3999);
  add(d(26), 'GOOGLE.GOOGLE.ONE/IRELAND', 'GOOGLE.GOOGLE.ONE IE', -299);
  if (month % 3 === 0) add(d(15), 'ARD ZDF Deutschlandradio Beitragsservice', 'Rundfunkbeitrag', -5508);
  if (month === 2) add(d(1), 'Beispiel Versicherung AG', 'Haftpflicht Jahresbeitrag', -6840);
  if (month === 10) add(d(27), 'Muster GmbH', 'Weihnachtsgeld', 120000);

  const grocers = ['Netto Marken-Discount', 'REWE Markt GmbH', 'ALDI SUED'];
  for (let i = 0; i < 11; i++) add(d(1 + Math.floor(rand() * 28)), grocers[Math.floor(rand() * 3)], 'VISA Debitkartenumsatz', -between(6, 46));
  for (let i = 0; i < 5; i++) add(d(1 + Math.floor(rand() * 28)), rand() > 0.5 ? 'CAFE LINDENBLATT' : 'Baeckerei Kraus', 'VISA Debitkartenumsatz', -between(3, 11));
  const amazon = ['AMAZON PAYMENTS EUROPE S.C.A.', 'AMAZON EU S.A R.L., NIEDERLASSUNG DEUTSCHLAND'];
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) add(d(2 + Math.floor(rand() * 25)), amazon[i % 2], `304-${Math.floor(rand() * 1e7)} AMZN Mktp DE`, -between(9, 70));
  if (rand() > 0.4) add(d(10 + Math.floor(rand() * 15)), 'MODEHAUS BECKER', 'VISA Debitkartenumsatz', -between(29, 95));
  add(d(4 + Math.floor(rand() * 20)), 'Drogerie Sonnenschein', 'VISA Debitkartenumsatz', -between(8, 34));
  for (let i = 0; i < 2 + Math.floor(rand() * 3); i++) add(d(1 + Math.floor(rand() * 28)), rand() > 0.5 ? 'TRATTORIA DA LUIGI' : 'SUSHI BAR KAITO', 'VISA Debitkartenumsatz', -between(16, 58));
  if (rand() > 0.5) add(d(8 + Math.floor(rand() * 18)), 'KINO AM PARK', 'VISA Debitkartenumsatz', -between(11, 24));
  if (rand() > 0.6) add(d(5 + Math.floor(rand() * 20)), 'DB Fernverkehr AG', 'Fahrkarte', -between(29, 89));
  add(d(6 + Math.floor(rand() * 20)), 'PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', 'PP.' + Math.floor(rand() * 1e4) + '.PP . Ihr Einkauf', -between(9, 45));
  if (rand() > 0.7) add(d(1 + Math.floor(rand() * 27)), 'KIOSK AM MARKT', 'VISA Debitkartenumsatz', -between(3, 9));
}
// The one-off "bike part" expected for the 25th is booked a few days late and a bit dearer.
add(dateInMonth(now, 28), 'AMAZON PAYMENTS EUROPE S.C.A.', '304-5550001 AMZN Mktp DE', -4990);
rows.push({ date: today, payee: 'REWE Markt GmbH', purpose: 'VISA Debitkartenumsatz', amount: -1230, pending: true });

rows.sort((a, b) => b.date.localeCompare(a.date));
const balance = 241837;
const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}`;
const eur = (c: number) => (c / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const csv = [
  'Girokonto;DE00 1234 5678 9012 3456 78;;;;;;;;;;',
  ';;;;;;;;;;;',
  `Kontostand vom ${de(today).slice(0, 6)}${today.slice(0, 4)}:;${eur(balance)} €;;;;;;;;;;`,
  ';;;;;;;;;;;',
  'Buchungsdatum;Wertstellung;Status;Zahlungspflichtige*r;Zahlungsempfänger*in;Verwendungszweck;Umsatztyp;IBAN;Betrag (€);Gläubiger-ID;Mandatsreferenz;Kundenreferenz',
  ...rows.map((r) => {
    const out = r.amount < 0;
    return [de(r.date), de(r.date), r.pending ? 'Vorgemerkt' : 'Gebucht', out ? 'Max Mustermann' : r.payee, out ? r.payee : 'Max Mustermann',
      r.purpose, out ? 'Ausgang' : 'Eingang', 'DE00000000000000000000', eur(r.amount), '', '', ''].join(';');
  })
].join('\n');
store.commitImport(csv, 'demo.csv');

// Categories, names and plans as a user would set them up.
const cats = store.state().categories;
const cat = (path: string) => {
  const [top, sub] = path.split(' › ');
  const parent = cats.find((c) => c.name === top && !c.parentId)!;
  return sub ? cats.find((c) => c.name === sub && c.parentId === parent.id)!.id : parent.id;
};
const rules: [('exact' | 'starts' | 'contains'), string, string, string][] = [
  ['starts', 'AMAZON', 'Amazon', 'Shopping › Online'],
  ['exact', 'Netto Marken-Discount', 'Netto', 'Lebensmittel › Supermarkt'],
  ['starts', 'REWE', 'REWE', 'Lebensmittel › Supermarkt'],
  ['starts', 'ALDI', 'ALDI', 'Lebensmittel › Supermarkt'],
  ['exact', 'CAFE LINDENBLATT', 'Café Lindenblatt', 'Lebensmittel › Bäckerei & Café'],
  ['exact', 'Baeckerei Kraus', 'Bäckerei Kraus', 'Lebensmittel › Bäckerei & Café'],
  ['contains', 'GOOGLE.ONE', 'Google One', 'Abos & Verträge › Cloud & Software'],
  ['exact', 'Hausverwaltung Beispiel KG', 'Landlord', 'Wohnen › Miete'],
  ['starts', 'Stadtwerke', 'Stadtwerke', 'Wohnen › Strom & Gas'],
  ['starts', 'Vodafone', 'Vodafone', 'Wohnen › Internet & Telefon'],
  ['exact', 'DB Vertrieb GmbH', 'Deutschlandticket', 'Mobilität › ÖPNV'],
  ['starts', 'DB Fernverkehr', 'Deutsche Bahn', 'Mobilität › Bahn & Fernverkehr'],
  ['exact', 'Muster GmbH', 'Muster GmbH', 'Einnahmen › Gehalt'],
  ['starts', 'FITNESSPARK', 'Fitnesspark', 'Freizeit › Sport'],
  ['starts', 'STREAMLY', 'Streamly', 'Abos & Verträge › Streaming'],
  ['starts', 'Mobilfunk Beispiel', 'Mobile plan', 'Wohnen › Internet & Telefon'],
  ['contains', 'Beitragsservice', 'TV licence', 'Abos & Verträge › Gebühren'],
  ['starts', 'Beispiel Versicherung', 'Liability insurance', 'Abos & Verträge › Versicherungen'],
  ['exact', 'MODEHAUS BECKER', 'Modehaus Becker', 'Shopping › Kleidung'],
  ['exact', 'Drogerie Sonnenschein', 'Drogerie Sonnenschein', 'Shopping › Haushalt'],
  ['exact', 'TRATTORIA DA LUIGI', 'Da Luigi', 'Freizeit › Restaurants'],
  ['exact', 'SUSHI BAR KAITO', 'Sushi Kaito', 'Freizeit › Restaurants'],
  ['exact', 'KINO AM PARK', 'Park Cinema', 'Freizeit › Kultur']
];
const payee: Record<string, number> = {};
for (const [type, pattern, name, path] of rules) payee[name] = store.saveRule({ matchType: type, pattern, name, categoryId: cat(path) }).payeeId;

const start = (monthsAgo: number, day: number) => dateInMonth(now - monthsAgo, day);
let firstQuarter = now - 11;
while (firstQuarter % 3 !== 0) firstQuarter++;
const march = Math.floor(now / 12) * 12 + 2;
const recurring: [string, string, number, number, string][] = [
  ['Salary', 'Muster GmbH', 265000, 1, start(11, 28)],
  ['Rent', 'Landlord', -85000, 1, start(11, 1)],
  ['Deutschlandticket', 'Deutschlandticket', -5800, 1, start(11, 1)],
  ['Gym', 'Fitnesspark', -3500, 1, start(11, 3)],
  ['Mobile plan', 'Mobile plan', -1400, 1, start(11, 5)],
  ['Streaming', 'Streamly', -1399, 1, start(11, 12)],
  ['Electricity', 'Stadtwerke', -6500, 1, start(11, 15)],
  ['Internet', 'Vodafone', -3999, 1, start(11, 23)],
  ['Google One', 'Google One', -299, 1, start(11, 26)],
  ['TV licence', 'TV licence', -5508, 3, dateInMonth(firstQuarter, 15)],
  ['Liability insurance', 'Liability insurance', -6840, 12, dateInMonth(march <= now ? march : march - 12, 1)]
];
const ids: Record<string, number> = {};
for (const [name, p, amount, frequency, startDate] of recurring) {
  ids[name] = store.createPlan({ type: 'recurring', name, payeeId: payee[p], frequency, startDate, amount, endDate: name === 'Gym' ? monthEnd(now + 5) : null });
}
store.addPlanAmount(ids.Rent, dateInMonth(now + 3, 1), -89000);

for (const [path, name, amount] of [['Lebensmittel', 'Groceries', -30000], ['Freizeit', 'Leisure', -15000], ['Shopping', 'Shopping', -12000]] as const) {
  store.createPlan({ type: 'budget', name, categoryId: cat(path), startDate: start(11, 1), amount });
}
store.createPlan({ type: 'oneoff', name: 'Car service', categoryId: cat('Mobilität › Auto'), startDate: dateInMonth(now + 1, 20), amount: -35000 });
store.createPlan({ type: 'oneoff', name: 'Christmas presents', categoryId: cat('Shopping'), startDate: dateInMonth(now + 2, 10), amount: -40000 });
store.createPlan({ type: 'oneoff', name: 'Holiday deposit', categoryId: cat('Freizeit'), startDate: dateInMonth(now + 4, 1), amount: -60000 });
store.createPlan({ type: 'oneoff', name: 'Tax refund', categoryId: cat('Einnahmen › Erstattungen'), startDate: dateInMonth(now + 5, 15), amount: 82000 });
store.createPlan({ type: 'oneoff', name: 'Bike part', payeeId: payee.Amazon, startDate: dateInMonth(now, 25), amount: -4500 });

// Link the past; leave this month's electricity, internet and the bike part open for the matching view.
const keepOpen = new Set([ids.Electricity, ids.Internet]);
const state = store.state();
const current = (date: string) => monthIndex(date) === now;
store.addMatches(suggestMatches(state).filter((s) => {
  const plan = state.plans.find((p) => p.id === s.planId)!;
  if (plan.type === 'oneoff') return false;
  return !(keepOpen.has(s.planId) && current(s.period));
}));

// The demo is shown in English, so the default categories get English names.
const EN: Record<string, string> = {
  Wohnen: 'Housing', Miete: 'Rent', 'Strom & Gas': 'Electricity & gas', 'Internet & Telefon': 'Internet & phone',
  Lebensmittel: 'Groceries', Supermarkt: 'Supermarket', 'Bäckerei & Café': 'Bakery & café',
  Mobilität: 'Transport', ÖPNV: 'Public transport', 'Bahn & Fernverkehr': 'Rail', Auto: 'Car',
  Kleidung: 'Clothing', Haushalt: 'Household', Freizeit: 'Leisure', Kultur: 'Culture',
  'Abos & Verträge': 'Subscriptions', 'Cloud & Software': 'Cloud & software', Versicherungen: 'Insurance', Gebühren: 'Fees',
  Einnahmen: 'Income', Gehalt: 'Salary', Erstattungen: 'Refunds'
};
for (const c of store.state().categories) if (EN[c.name]) store.updateCategory(c.id, { name: EN[c.name] });

console.log(`Demo database ${file}: ${store.state().transactions.length} transactions, ${store.state().plans.length} plans.`);
