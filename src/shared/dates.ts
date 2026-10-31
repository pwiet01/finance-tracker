// Date helpers on plain ISO strings, free of time zones.

export function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y, m - 1, d];
}

export function iso(y: number, m: number, d: number): string {
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Month index since year 0, handy for month arithmetic. */
export function monthIndex(isoDate: string): number {
  const [y, m] = parts(isoDate);
  return y * 12 + m;
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function monthStart(index: number): string {
  return iso(Math.floor(index / 12), index % 12, 1);
}

export function monthEnd(index: number): string {
  const y = Math.floor(index / 12), m = index % 12;
  return iso(y, m, daysInMonth(y, m));
}

/** Date in the given month with the day clamped to the month length. */
export function dateInMonth(index: number, day: number): string {
  const y = Math.floor(index / 12), m = index % 12;
  return iso(y, m, Math.min(day, daysInMonth(y, m)));
}

export function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(ay, am, ad) - Date.UTC(by, bm, bd)) / 86_400_000);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = parts(isoDate);
  const t = new Date(Date.UTC(y, m, d + days));
  return iso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
}

export function todayIso(): string {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth(), t.getDate());
}
