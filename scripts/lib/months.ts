// Month arithmetic on "YYYY-MM" strings.
export type Month = `${number}-${string}`;

export const FIRST_AVAILABLE: Month = "2015-07"; // pageviews API data starts July 2015

export function parseMonth(s: string): Month {
  const m = /^(\d{4})-?(\d{2})$/.exec(s.trim());
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Bad month "${s}", expected YYYY-MM`);
  return `${m[1]}-${m[2]}` as Month;
}
export function addMonths(m: Month, n: number): Month {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}` as Month;
}
export function cmpMonth(a: Month, b: Month): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function monthRange(start: Month, end: Month): Month[] {
  const out: Month[] = [];
  for (let m = start; cmpMonth(m, end) <= 0; m = addMonths(m, 1)) out.push(m);
  return out;
}
export function currentMonth(now = new Date()): Month {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}` as Month;
}
/** Last month with complete data (data for a month is published a day or two after it ends). */
export function lastCompleteMonth(now = new Date()): Month {
  const cm = currentMonth(now);
  return now.getUTCDate() >= 3 ? addMonths(cm, -1) : addMonths(cm, -2);
}
export function monthStart(m: Month): string {
  return `${m}-01`;
}
export function monthEnd(m: Month): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${m}-${String(d).padStart(2, "0")}`;
}
export function monthsBetween(a: Month, b: Month): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
