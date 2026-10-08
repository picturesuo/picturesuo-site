/**
 * The pure half of the daily check-in: dates, the log's shape, streaks, and
 * what a private note looks like. No DOM, no network, so it runs under
 * `node --test` as well as in the browser.
 *
 * The log is `src/data/log.json`: one object per logged day, sorted by date.
 * A day that was skipped has no object at all - never a row of zeros - because
 * a blank square on the calendar is the honest reading of a blank day.
 */

export const TRACKS = ['writing', 'tech', 'clay', 'photos', 'posts'] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  writing: 'Writing',
  tech: 'Technical',
  clay: 'Clay',
  photos: 'Photos',
  posts: 'Posts',
};

export interface Entry {
  date: string;
  writing: number;
  tech: number;
  clay: number;
  photos: number;
  posts: number;
  flag: boolean;
}

export type Counts = Record<Track, number>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date where the phone is, as YYYY-MM-DD. The calendar is a local-time thing. */
export function localDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Move a YYYY-MM-DD string by whole days. Done in UTC so DST cannot skip or repeat a day. */
export function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const t = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
}

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
    ...opts,
  }).format(new Date(`${date}T00:00:00Z`));
}

export function total(e: Pick<Entry, Track>): number {
  return TRACKS.reduce((sum, t) => sum + (Number(e[t]) || 0), 0);
}

/**
 * Five zeros and no broken rule. Saving one on purpose records a zero day;
 * the page only ever refuses to invent one for a day that was skipped.
 */
export function isBlank(e: Pick<Entry, Track | 'flag'>): boolean {
  return total(e) === 0 && !e.flag;
}

export function makeEntry(date: string, counts: Counts, flag: boolean): Entry {
  if (!isValidDate(date)) throw new Error(`Not a date: ${date}`);
  const entry = { date } as Entry;
  for (const t of TRACKS) {
    const n = counts[t];
    if (!Number.isInteger(n) || n < 0 || n > 4) throw new Error(`${t} must be 0-4, got ${n}`);
    entry[t] = n;
  }
  entry.flag = Boolean(flag);
  return entry;
}

/** Parse log.json, tolerating nothing: the file is small and a bad shape should be loud. */
export function parseLog(text: string): Entry[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error('log.json is not an array');
  return raw.map((row, i) => {
    if (!row || typeof row !== 'object') throw new Error(`log.json[${i}] is not an object`);
    const r = row as Record<string, unknown>;
    if (typeof r.date !== 'string' || !isValidDate(r.date)) {
      throw new Error(`log.json[${i}] has no valid date`);
    }
    const entry = { date: r.date } as Entry;
    for (const t of TRACKS) entry[t] = Number(r[t] ?? 0) || 0;
    entry.flag = Boolean(r.flag);
    return entry;
  });
}

/** The exact byte shape `counts:export` in the life-log repo writes, so diffs stay quiet. */
export function serializeLog(log: Entry[]): string {
  return `${JSON.stringify(log, null, 1)}\n`;
}

/**
 * Replace or add one day and return a new sorted array. Every other day is
 * carried through untouched, which is what makes a read-modify-write against
 * the live file safe when something else has edited it in between.
 */
export function upsert(log: Entry[], entry: Entry): Entry[] {
  const next = log.filter((e) => e.date !== entry.date);
  next.push(entry);
  next.sort((a, b) => a.date.localeCompare(b.date));
  return next;
}

export function byDate(log: Entry[]): Map<string, Entry> {
  const m = new Map<string, Entry>();
  for (const e of log) m.set(e.date, e);
  return m;
}

export interface Day {
  date: string;
  entry: Entry | null;
}

/** The last `n` days ending on `today`, oldest first. A missing day is `entry: null`. */
export function recentDays(log: Entry[], today: string, n = 14): Day[] {
  const map = byDate(log);
  const days: Day[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = shiftDate(today, -i);
    days.push({ date, entry: map.get(date) ?? null });
  }
  return days;
}

/**
 * Consecutive logged days ending today - or ending yesterday if today is not
 * logged yet, so the number does not fall to zero every morning before the
 * day has had a chance to happen.
 */
export function streak(log: Entry[], today: string): number {
  const map = byDate(log);
  let cursor = map.has(today) ? today : shiftDate(today, -1);
  let run = 0;
  while (map.has(cursor)) {
    run++;
    cursor = shiftDate(cursor, -1);
  }
  return run;
}

export function privateNotePath(date: string): string {
  return `checkins/${date}.md`;
}

/**
 * The private record of a check-in. It carries the counts too, so the private
 * repo is a complete record on its own; the note never travels the other way.
 */
export function privateNote(entry: Entry, note: string): string {
  const body = note.trim();
  const lines = ['---', `date: ${entry.date}`, 'private: true'];
  for (const t of TRACKS) lines.push(`${t}: ${entry[t]}`);
  lines.push(`flag: ${entry.flag}`, '---', '', `# ${entry.date}`, '');
  lines.push(body ? body : '_No note._');
  return `${lines.join('\n')}\n`;
}

/** The line back out of a private note file; '' when there is none. */
export function noteBody(text: string): string {
  const close = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  const after = close < 0 ? text : text.slice(close + 5);
  const body = after.replace(/^\s*# \S+\s*/, '').trim();
  return body === '_No note._' ? '' : body;
}

/**
 * What to commit for a day's private note. The field wins only when the user
 * changed it from what the page showed (`shown`); otherwise the note already
 * in the file is kept, so a correction to the counts never erases the words
 * and a line edited by hand after the page loaded is not rolled back.
 */
export function mergePrivateNote(
  entry: Entry,
  field: string,
  shown: string,
  current: string | null,
): string {
  const typed = field.trim();
  const changed = typed === shown ? '' : typed;
  return privateNote(entry, changed || (current ? noteBody(current) : ''));
}

export function commitMessage(date: string, replacing: boolean): string {
  return `${replacing ? 'Update' : 'Log'} ${date}`;
}
