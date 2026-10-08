/**
 * The model behind the per-category calendars on /progress/.
 *
 * Pure functions, no DOM: the component renders what these return and the test
 * file exercises them directly. Dates are the ISO date strings in
 * src/data/log.json, laid out in UTC, which is how the rest of the site treats
 * them. Which day is "today" is the viewer's local date, so everything that
 * depends on it (future days, the stats, the home square) is scored in the
 * browser, not at build time.
 *
 * Three kinds of day are kept apart on purpose:
 *   - absent:   no entry exists for the date. The day was skipped, or it has
 *               not happened yet. Nothing is invented for it.
 *   - recorded: an entry exists. Its count may be zero, and a recorded zero is
 *               a real statement ("I did none of this today") that must look
 *               different from a day with no entry at all.
 *   - future:   after the viewer's today. Still absent, but not a skipped day.
 */

export const CATEGORIES = [
  { key: 'writing', name: 'Writing', color: 'var(--green)' },
  { key: 'tech', name: 'Technical', color: 'var(--blue)' },
  { key: 'clay', name: 'Clay', color: 'var(--coral)' },
  { key: 'photos', name: 'Photos', color: 'var(--amber)' },
  { key: 'posts', name: 'Posts', color: 'var(--plum)' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];
export type Category = (typeof CATEGORIES)[number];

/** Per-count fill, as a percentage of the category colour mixed into paper. */
export const RAMP = [0, 28, 50, 74, 100] as const;

export const MAX_COUNT = 4;

export interface LogEntry {
  date: string;
  flag: boolean;
  counts: Record<CategoryKey, number>;
}

export interface DayCell {
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** Monday-first weekday index, 0..6. */
  weekday: number;
  /** Zero-based week column in the grid. */
  week: number;
  /** Padding before the requested start date (the grid opens on a Monday). */
  before: boolean;
  /** An entry exists for this date. */
  recorded: boolean;
  /** Count for this category, clamped to 0..MAX_COUNT. 0 when not recorded. */
  count: number;
  /** An anti-goal was marked that day. Independent of the category. */
  flag: boolean;
}

export interface MonthLabel {
  /** Zero-based week column where the label sits. */
  week: number;
  label: string;
}

export interface CategoryGrid {
  category: Category;
  weeks: number;
  days: DayCell[];
  months: MonthLabel[];
}

/** What the live window adds up to, for one category, as of a given today. */
export interface GridStats {
  /** Days on or after start, up to and including today, that have an entry. */
  recordedDays: number;
  /** Of those, days where this category's count is above zero. */
  activeDays: number;
  /** Consecutive active days ending at the last recorded day. */
  streak: number;
  longest: number;
  /** Anti-goal days in the same window. */
  flagged: number;
}

const DAY = 86400000;

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The viewer's calendar date, in their own timezone. */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const d = new Date(`${s}T00:00:00Z`);
  // A rolled-over date such as 2026-02-30 parses, so insist on a round trip.
  if (Number.isNaN(d.getTime()) || isoDate(d) !== s) throw new Error(`invalid date: ${s}`);
  return d;
}

/** Monday-first weekday index for an ISO date. */
export function mondayIndex(d: Date): number {
  return (d.getUTCDay() + 6) % 7;
}

/**
 * Coerce a raw count into 0..MAX_COUNT. Anything that is not a finite number
 * reads as zero; fractions round down; out-of-range values are clamped rather
 * than thrown, because a bad export must not take the page down.
 */
export function clampCount(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_COUNT, Math.max(0, Math.floor(n)));
}

/**
 * Turn the raw JSON array into typed entries, keyed by date. Entries without a
 * parseable date are dropped. Duplicate dates keep the last one, which matches
 * how the check-in page rewrites a day in place.
 */
export function normalizeLog(raw: unknown): Map<string, LogEntry> {
  const out = new Map<string, LogEntry>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const date = typeof rec.date === 'string' ? rec.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    try {
      parseIsoDate(date);
    } catch {
      continue;
    }
    const counts = {} as Record<CategoryKey, number>;
    for (const c of CATEGORIES) counts[c.key] = clampCount(rec[c.key]);
    out.set(date, { date, flag: rec.flag === true, counts });
  }
  return out;
}

export interface GridOptions {
  start: string;
  weeks: number;
}

/** Lay out the window: the same for every viewer, so it can render at build time. */
export function buildCategoryGrid(
  log: Map<string, LogEntry>,
  category: Category,
  opts: GridOptions,
): CategoryGrid {
  const startDate = parseIsoDate(opts.start);
  const weeks = Math.max(1, Math.floor(opts.weeks));
  const first = new Date(startDate.getTime() - mondayIndex(startDate) * DAY);

  const days: DayCell[] = [];
  const months: MonthLabel[] = [];
  let lastMonth = -1;

  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(first.getTime() + i * DAY);
    const date = isoDate(d);
    const entry = log.get(date);
    const week = Math.floor(i / 7);
    const weekday = i % 7;
    if (weekday === 0) {
      // Label a column when its Monday is in a different month from the
      // previous column's Monday. A label that would sit fewer than three
      // columns before the next one is dropped, so two short names never
      // collide (a padding week in August right before September).
      const m = d.getUTCMonth();
      if (m !== lastMonth) {
        const prev = months[months.length - 1];
        if (prev && week - prev.week < 3) months.pop();
        months.push({ week, label: MONTHS[m] });
        lastMonth = m;
      }
    }
    days.push({
      date,
      weekday,
      week,
      before: date < opts.start,
      recorded: Boolean(entry),
      count: entry ? entry.counts[category.key] : 0,
      flag: Boolean(entry && entry.flag),
    });
  }

  return { category, weeks, days, months };
}

/** A day after the viewer's today: not a skipped day, just one that has not come. */
export function isFuture(day: DayCell, today: string): boolean {
  return day.date > today;
}

/** Stats run over the live window only: on or after start, not in the future. */
export function scoreGrid(days: DayCell[], today: string): GridStats {
  let recordedDays = 0;
  let activeDays = 0;
  let flagged = 0;
  let run = 0;
  let longest = 0;
  for (const day of days) {
    if (day.before || isFuture(day, today)) continue;
    if (!day.recorded) {
      // A skipped day breaks a streak the same way a recorded zero does; the
      // difference between the two is shown, not scored. Today is the one
      // exception: the day is still open, so an entry may yet arrive.
      if (day.date !== today) run = 0;
      continue;
    }
    recordedDays++;
    if (day.flag) flagged++;
    if (day.count > 0) {
      activeDays++;
      run++;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return { recordedDays, activeDays, streak: run, longest, flagged };
}

/**
 * The one square that takes the tab stop: the latest recorded day in the live
 * window, or today if nothing is recorded yet, or the first live day.
 */
export function homeIndex(days: DayCell[], today: string): number {
  let idx = -1;
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.before || isFuture(d, today)) continue;
    if (d.recorded) idx = i;
  }
  if (idx >= 0) return idx;
  const t = days.findIndex((d) => d.date === today);
  return t >= 0 ? t : days.findIndex((d) => !d.before);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const longDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(date: string): string {
  return longDate.format(parseIsoDate(date));
}

/** The sentence a square reads out when tapped or focused. */
export function describeDay(day: DayCell, category: Category, today: string): string {
  const when = formatDate(day.date);
  const name = category.name.toLowerCase();
  let what: string;
  if (isFuture(day, today)) what = 'not yet';
  else if (!day.recorded) what = 'no entry';
  else if (day.count === 0) what = `${name} 0, recorded`;
  else what = `${name} ${day.count} of ${MAX_COUNT}`;
  return `${when}: ${what}${day.flag ? ', anti-goal' : ''}`;
}

/** The CSS background for a square, or an empty string for the default. */
export function cellBackground(day: DayCell, category: Category): string {
  if (!day.recorded || day.count === 0) return '';
  const pct = RAMP[day.count] ?? RAMP[MAX_COUNT];
  return `color-mix(in srgb, ${category.color} ${pct}%, var(--paper-deep))`;
}
