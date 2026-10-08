/**
 * Run with:  npm test
 *
 * That is node --test over src/lib/*.test.ts. Node strips the types itself;
 * nothing is installed for this. The fixtures below are synthetic and never
 * belong in src/data/log.json.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORIES,
  MAX_COUNT,
  buildCategoryGrid,
  cellBackground,
  clampCount,
  describeDay,
  homeIndex,
  isFuture,
  localToday,
  normalizeLog,
  scoreGrid,
} from './categoryCalendar.ts';

const writing = CATEGORIES[0];
const clay = CATEGORIES[2];

const entry = (date: string, counts: Partial<Record<string, unknown>> = {}, flag = false) => ({
  date,
  writing: 0,
  tech: 0,
  clay: 0,
  photos: 0,
  posts: 0,
  flag,
  ...counts,
});

test('five categories, in the order the site uses, each with a token colour', () => {
  assert.deepEqual(
    CATEGORIES.map((c) => c.key),
    ['writing', 'tech', 'clay', 'photos', 'posts'],
  );
  for (const c of CATEGORIES) assert.match(c.color, /^var\(--[a-z]+\)$/);
});

test('clampCount accepts only an integer number 0..4; anything else is 0', () => {
  for (let n = 0; n <= MAX_COUNT; n++) assert.equal(clampCount(n), n);
  assert.equal(clampCount(5), 0, 'above the range is not clamped down');
  assert.equal(clampCount(99), 0);
  assert.equal(clampCount(-1), 0);
  assert.equal(clampCount(2.9), 0, 'a fraction is not rounded');
  assert.equal(clampCount('3'), 0, 'a numeric string is not parsed');
  assert.equal(clampCount('x'), 0);
  assert.equal(clampCount(true), 0);
  assert.equal(clampCount(NaN), 0);
  assert.equal(clampCount(Infinity), 0, 'not finite is not a count');
  assert.equal(clampCount(undefined), 0);
  assert.equal(clampCount(null), 0);
});

test('localToday is the calendar date in the local timezone, not UTC', () => {
  // Half past eleven at night, local time: still that day locally even when
  // the UTC date has already rolled over (or has not yet).
  const late = new Date(2026, 9, 8, 23, 30);
  assert.equal(localToday(late), '2026-10-08');
  const early = new Date(2026, 9, 8, 0, 15);
  assert.equal(localToday(early), '2026-10-08');
  const jan = new Date(2027, 0, 1, 12);
  assert.equal(localToday(jan), '2027-01-01');
});

test('normalizeLog: empty, malformed, duplicate dates', () => {
  assert.equal(normalizeLog([]).size, 0);
  assert.equal(normalizeLog(null).size, 0);
  assert.equal(normalizeLog('nope').size, 0);
  const log = normalizeLog([
    entry('2026-10-06'),
    { date: 'not-a-date', writing: 3 },
    { date: '2026-02-30', writing: 3 }, // rolls over: rejected, not invented
    { writing: 2 },
    null,
    entry('2026-10-06', { writing: 2 }), // later duplicate wins
    entry('2026-10-07', { tech: 3, clay: 7, posts: '1', photos: -2 }, true),
  ]);
  assert.deepEqual([...log.keys()], ['2026-10-06', '2026-10-07']);
  assert.equal(log.get('2026-10-06')!.counts.writing, 2);
  const d7 = log.get('2026-10-07')!;
  assert.equal(d7.counts.tech, 3);
  assert.equal(d7.counts.clay, 0, 'out of range is not a count');
  assert.equal(d7.counts.posts, 0, 'a string is not a count');
  assert.equal(d7.counts.photos, 0);
  assert.equal(d7.flag, true);
});

test('empty log: every live day is absent, nothing is scored, nothing is invented', () => {
  const grid = buildCategoryGrid(normalizeLog([]), writing, { start: '2026-09-01', weeks: 6 });
  assert.equal(grid.days.length, 42);
  assert.ok(grid.days.every((d) => !d.recorded && d.count === 0 && !d.flag));
  const s = scoreGrid(grid.days, '2026-10-08');
  assert.equal(s.recordedDays, 0);
  assert.equal(s.activeDays, 0);
  assert.equal(s.streak, 0);
  assert.equal(s.longest, 0);
  assert.equal(s.flagged, 0);
});

test('grid opens on the Monday before start and marks padding days', () => {
  // 2026-09-01 is a Tuesday, so the grid starts Monday 2026-08-31.
  const grid = buildCategoryGrid(normalizeLog([]), writing, { start: '2026-09-01', weeks: 2 });
  assert.equal(grid.days[0].date, '2026-08-31');
  assert.equal(grid.days[0].weekday, 0);
  assert.equal(grid.days[0].before, true);
  assert.equal(grid.days[1].date, '2026-09-01');
  assert.equal(grid.days[1].before, false);
  assert.equal(grid.days[7].week, 1);
  assert.equal(grid.days[13].date, '2026-09-13');
  assert.equal(grid.days[13].weekday, 6);
});

test('a Monday start has no padding', () => {
  const grid = buildCategoryGrid(normalizeLog([]), writing, { start: '2026-09-07', weeks: 1 });
  assert.equal(grid.days[0].date, '2026-09-07');
  assert.ok(grid.days.every((d) => !d.before));
});

test('mixed entries: counts land on the right date, per category', () => {
  const log = normalizeLog([
    entry('2026-10-06'),
    entry('2026-10-07', { clay: 4, posts: 1 }, true),
    entry('2026-10-08', { writing: 2, clay: 1 }),
  ]);
  const opts = { start: '2026-10-05', weeks: 1 };
  const today = '2026-10-08';
  const clayGrid = buildCategoryGrid(log, clay, opts);
  const byDate = Object.fromEntries(clayGrid.days.map((d) => [d.date, d]));
  assert.equal(byDate['2026-10-05'].recorded, false);
  assert.equal(byDate['2026-10-06'].recorded, true);
  assert.equal(byDate['2026-10-06'].count, 0);
  assert.equal(byDate['2026-10-07'].count, 4);
  assert.equal(byDate['2026-10-07'].flag, true);
  assert.equal(byDate['2026-10-08'].count, 1);
  assert.equal(byDate['2026-10-08'].flag, false);

  const writingGrid = buildCategoryGrid(log, writing, opts);
  const w = Object.fromEntries(writingGrid.days.map((d) => [d.date, d]));
  assert.equal(w['2026-10-07'].count, 0);
  assert.equal(w['2026-10-07'].recorded, true);
  assert.equal(w['2026-10-07'].flag, true, 'anti-goal survives every category');
  assert.equal(w['2026-10-08'].count, 2);

  const c = scoreGrid(clayGrid.days, today);
  assert.equal(c.recordedDays, 3);
  assert.equal(c.activeDays, 2);
  assert.equal(c.streak, 2);
  assert.equal(c.longest, 2);
  assert.equal(c.flagged, 1);
  const ws = scoreGrid(writingGrid.days, today);
  assert.equal(ws.activeDays, 1);
  assert.equal(ws.streak, 1);
});

test('recorded zero and absent day are different cells and different sentences', () => {
  const log = normalizeLog([entry('2026-10-06')]);
  const grid = buildCategoryGrid(log, writing, { start: '2026-10-05', weeks: 1 });
  const today = '2026-10-08';
  const zero = grid.days.find((d) => d.date === '2026-10-06')!;
  const absent = grid.days.find((d) => d.date === '2026-10-05')!;
  const future = grid.days.find((d) => d.date === '2026-10-09')!;
  assert.equal(zero.recorded, true);
  assert.equal(zero.count, 0);
  assert.equal(absent.recorded, false);
  assert.equal(isFuture(absent, today), false);
  assert.equal(future.recorded, false);
  assert.equal(isFuture(future, today), true);
  assert.equal(describeDay(zero, writing, today), 'Tue, Oct 6, 2026: writing 0, recorded');
  assert.equal(describeDay(absent, writing, today), 'Mon, Oct 5, 2026: no entry');
  assert.equal(describeDay(future, writing, today), 'Fri, Oct 9, 2026: not yet');
  // Neither draws a colour; the component tells them apart with a marker.
  assert.equal(cellBackground(zero, writing), '');
  assert.equal(cellBackground(absent, writing), '');
});

test('the same day reads as today or not yet depending on whose today it is', () => {
  const grid = buildCategoryGrid(normalizeLog([]), writing, { start: '2026-10-05', weeks: 1 });
  const oct8 = grid.days.find((d) => d.date === '2026-10-08')!;
  // The build machine has already rolled into the 9th; the viewer has not.
  assert.equal(isFuture(oct8, '2026-10-08'), false);
  assert.equal(describeDay(oct8, writing, '2026-10-08'), 'Thu, Oct 8, 2026: no entry');
  // A viewer a day behind still sees the 8th as not yet.
  assert.equal(isFuture(oct8, '2026-10-07'), true);
  assert.equal(describeDay(oct8, writing, '2026-10-07'), 'Thu, Oct 8, 2026: not yet');
});

test('describeDay and cellBackground across the count range', () => {
  const log = normalizeLog([
    entry('2026-10-05', { clay: 1 }),
    entry('2026-10-06', { clay: 2 }),
    entry('2026-10-07', { clay: 3 }),
    entry('2026-10-08', { clay: 4 }, true),
  ]);
  const grid = buildCategoryGrid(log, clay, { start: '2026-10-05', weeks: 1 });
  const [d1, d2, d3, d4] = grid.days;
  assert.equal(describeDay(d1, clay, '2026-10-08'), 'Mon, Oct 5, 2026: clay 1 of 4');
  assert.equal(describeDay(d4, clay, '2026-10-08'), 'Thu, Oct 8, 2026: clay 4 of 4, anti-goal');
  assert.equal(cellBackground(d1, clay), 'color-mix(in srgb, var(--coral) 28%, var(--paper-deep))');
  assert.equal(cellBackground(d2, clay), 'color-mix(in srgb, var(--coral) 50%, var(--paper-deep))');
  assert.equal(cellBackground(d3, clay), 'color-mix(in srgb, var(--coral) 74%, var(--paper-deep))');
  assert.equal(
    cellBackground(d4, clay),
    'color-mix(in srgb, var(--coral) 100%, var(--paper-deep))',
  );
});

test('a skipped day and a recorded zero both break a streak', () => {
  const log = normalizeLog([
    entry('2026-10-01', { writing: 1 }),
    entry('2026-10-02', { writing: 1 }),
    // 10-03 skipped
    entry('2026-10-04', { writing: 1 }),
    entry('2026-10-05', { writing: 0 }),
    entry('2026-10-06', { writing: 3 }),
  ]);
  const grid = buildCategoryGrid(log, writing, { start: '2026-10-01', weeks: 2 });
  const s = scoreGrid(grid.days, '2026-10-06');
  assert.equal(s.longest, 2);
  assert.equal(s.streak, 1);
  assert.equal(s.activeDays, 4);
  assert.equal(s.recordedDays, 5);
});

test('an unlogged today does not break the streak; an unlogged yesterday does', () => {
  const log = normalizeLog([entry('2026-10-06', { clay: 2 }), entry('2026-10-07', { clay: 4 })]);
  const grid = buildCategoryGrid(log, clay, { start: '2026-10-05', weeks: 1 });
  assert.equal(scoreGrid(grid.days, '2026-10-08').streak, 2, 'today is still open');
  const closed = scoreGrid(grid.days, '2026-10-09');
  assert.equal(closed.streak, 0, 'yesterday was skipped');
  assert.equal(closed.longest, 2);
  // The viewer's clock decides: the same grid scored on the 7th is still live.
  assert.equal(scoreGrid(grid.days, '2026-10-07').streak, 2);
});

test('future entries are not scored even if present', () => {
  const log = normalizeLog([entry('2026-10-09', { writing: 4 })]);
  const grid = buildCategoryGrid(log, writing, { start: '2026-10-05', weeks: 1 });
  const f = grid.days.find((d) => d.date === '2026-10-09')!;
  assert.equal(isFuture(f, '2026-10-08'), true);
  assert.equal(f.count, 4, 'the data is still shown');
  assert.equal(scoreGrid(grid.days, '2026-10-08').activeDays, 0, 'but not counted');
  assert.equal(scoreGrid(grid.days, '2026-10-09').activeDays, 1, 'until the viewer gets there');
});

test('homeIndex: latest recorded live day, else today, else the first live day', () => {
  const log = normalizeLog([entry('2026-10-06', { clay: 2 }), entry('2026-10-09', { clay: 1 })]);
  const grid = buildCategoryGrid(log, clay, { start: '2026-10-06', weeks: 2 });
  const at = (date: string) => grid.days.findIndex((d) => d.date === date);
  assert.equal(homeIndex(grid.days, '2026-10-08'), at('2026-10-06'), 'the 9th is not yet');
  assert.equal(homeIndex(grid.days, '2026-10-09'), at('2026-10-09'));
  const empty = buildCategoryGrid(normalizeLog([]), clay, { start: '2026-10-06', weeks: 2 });
  assert.equal(homeIndex(empty.days, '2026-10-08'), at('2026-10-08'), 'today, nothing recorded');
  assert.equal(homeIndex(empty.days, '2026-10-01'), at('2026-10-06'), 'before the window opens');
});

test('month boundaries and a leap day', () => {
  // 2028 is a leap year. 2028-02-28 is a Monday.
  const log = normalizeLog([
    entry('2028-02-29', { writing: 2 }),
    entry('2028-03-01', { writing: 1 }),
  ]);
  const grid = buildCategoryGrid(log, writing, { start: '2028-02-28', weeks: 6 });
  const dates = grid.days.map((d) => d.date);
  assert.equal(dates[0], '2028-02-28');
  assert.equal(dates[1], '2028-02-29');
  assert.equal(dates[2], '2028-03-01');
  assert.equal(grid.days[1].count, 2);
  assert.equal(grid.days[2].count, 1);
  assert.equal(dates[dates.length - 1], '2028-04-09');
  // Column 0 is February but March starts in column 1, too close to label
  // both; the first Monday in April is 04-03 (column 5).
  assert.deepEqual(grid.months, [
    { week: 1, label: 'Mar' },
    { week: 5, label: 'Apr' },
  ]);
  const s = scoreGrid(grid.days, '2028-04-30');
  assert.equal(s.activeDays, 2);
  assert.equal(s.longest, 2);
});

test('month labels keep their distance', () => {
  // 2026-09-01 is a Tuesday: the grid opens on Mon 08-31, a lone August week.
  const grid = buildCategoryGrid(normalizeLog([]), writing, { start: '2026-09-01', weeks: 10 });
  assert.deepEqual(grid.months, [
    { week: 1, label: 'Sep' },
    { week: 5, label: 'Oct' },
    { week: 9, label: 'Nov' },
  ]);
  for (let i = 1; i < grid.months.length; i++) {
    assert.ok(grid.months[i].week - grid.months[i - 1].week >= 3);
  }
});

test('a year boundary keeps dates monotonic', () => {
  const grid = buildCategoryGrid(normalizeLog([]), writing, { start: '2026-12-28', weeks: 2 });
  const dates = grid.days.map((d) => d.date);
  assert.equal(dates[0], '2026-12-28');
  assert.equal(dates[3], '2026-12-31');
  assert.equal(dates[4], '2027-01-01');
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] > dates[i - 1]);
  // One December column is too narrow for a label of its own.
  assert.deepEqual(grid.months, [{ week: 1, label: 'Jan' }]);
});

test('rejects an invalid start date instead of rendering garbage', () => {
  assert.throws(() =>
    buildCategoryGrid(normalizeLog([]), writing, { start: '2026-13-01', weeks: 1 }),
  );
});
