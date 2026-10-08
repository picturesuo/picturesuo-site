/**
 * Run with:  node --test src/lib/categoryCalendar.test.ts
 *
 * Node strips the types itself; nothing is installed for this. The fixtures
 * below are synthetic and never belong in src/data/log.json.
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
  normalizeLog,
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

test('clampCount bounds every input to 0..4', () => {
  assert.equal(clampCount(0), 0);
  assert.equal(clampCount(4), 4);
  assert.equal(clampCount(5), MAX_COUNT);
  assert.equal(clampCount(99), MAX_COUNT);
  assert.equal(clampCount(-1), 0);
  assert.equal(clampCount(2.9), 2);
  assert.equal(clampCount('3'), 3);
  assert.equal(clampCount('x'), 0);
  assert.equal(clampCount(NaN), 0);
  assert.equal(clampCount(Infinity), 0, 'not finite is not a count');
  assert.equal(clampCount(undefined), 0);
  assert.equal(clampCount(null), 0);
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
    entry('2026-10-07', { clay: 7, posts: '1', photos: -2 }, true),
  ]);
  assert.deepEqual([...log.keys()], ['2026-10-06', '2026-10-07']);
  assert.equal(log.get('2026-10-06')!.counts.writing, 2);
  const d7 = log.get('2026-10-07')!;
  assert.equal(d7.counts.clay, 4);
  assert.equal(d7.counts.posts, 1);
  assert.equal(d7.counts.photos, 0);
  assert.equal(d7.flag, true);
});

test('empty log: every live day is absent, nothing is scored, nothing is invented', () => {
  const grid = buildCategoryGrid(normalizeLog([]), writing, {
    start: '2026-09-01',
    weeks: 6,
    today: '2026-10-08',
  });
  assert.equal(grid.days.length, 42);
  assert.ok(grid.days.every((d) => !d.recorded && d.count === 0 && !d.flag));
  assert.equal(grid.recordedDays, 0);
  assert.equal(grid.activeDays, 0);
  assert.equal(grid.streak, 0);
  assert.equal(grid.longest, 0);
  assert.equal(grid.flagged, 0);
});

test('grid opens on the Monday before start and marks padding days', () => {
  // 2026-09-01 is a Tuesday, so the grid starts Monday 2026-08-31.
  const grid = buildCategoryGrid(normalizeLog([]), writing, {
    start: '2026-09-01',
    weeks: 2,
    today: '2026-10-08',
  });
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
  const grid = buildCategoryGrid(normalizeLog([]), writing, {
    start: '2026-09-07',
    weeks: 1,
    today: '2026-10-08',
  });
  assert.equal(grid.days[0].date, '2026-09-07');
  assert.ok(grid.days.every((d) => !d.before));
});

test('mixed entries: counts land on the right date, per category', () => {
  const log = normalizeLog([
    entry('2026-10-06'),
    entry('2026-10-07', { clay: 4, posts: 1 }, true),
    entry('2026-10-08', { writing: 2, clay: 1 }),
  ]);
  const opts = { start: '2026-10-05', weeks: 1, today: '2026-10-08' };
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

  assert.equal(clayGrid.recordedDays, 3);
  assert.equal(clayGrid.activeDays, 2);
  assert.equal(clayGrid.streak, 2);
  assert.equal(clayGrid.longest, 2);
  assert.equal(clayGrid.flagged, 1);
  assert.equal(writingGrid.activeDays, 1);
  assert.equal(writingGrid.streak, 1);
});

test('recorded zero and absent day are different cells and different sentences', () => {
  const log = normalizeLog([entry('2026-10-06')]);
  const grid = buildCategoryGrid(log, writing, {
    start: '2026-10-05',
    weeks: 1,
    today: '2026-10-08',
  });
  const zero = grid.days.find((d) => d.date === '2026-10-06')!;
  const absent = grid.days.find((d) => d.date === '2026-10-05')!;
  const future = grid.days.find((d) => d.date === '2026-10-09')!;
  assert.equal(zero.recorded, true);
  assert.equal(zero.count, 0);
  assert.equal(absent.recorded, false);
  assert.equal(absent.future, false);
  assert.equal(future.recorded, false);
  assert.equal(future.future, true);
  assert.equal(describeDay(zero, writing), 'Tue, Oct 6, 2026: writing 0, recorded');
  assert.equal(describeDay(absent, writing), 'Mon, Oct 5, 2026: no entry');
  assert.equal(describeDay(future, writing), 'Fri, Oct 9, 2026: not yet');
  // Neither draws a colour; the component tells them apart with a marker.
  assert.equal(cellBackground(zero, writing), '');
  assert.equal(cellBackground(absent, writing), '');
});

test('describeDay and cellBackground across the count range', () => {
  const log = normalizeLog([
    entry('2026-10-05', { clay: 1 }),
    entry('2026-10-06', { clay: 2 }),
    entry('2026-10-07', { clay: 3 }),
    entry('2026-10-08', { clay: 4 }, true),
  ]);
  const grid = buildCategoryGrid(log, clay, {
    start: '2026-10-05',
    weeks: 1,
    today: '2026-10-08',
  });
  const [d1, d2, d3, d4] = grid.days;
  assert.equal(describeDay(d1, clay), 'Mon, Oct 5, 2026: clay 1 of 4');
  assert.equal(describeDay(d4, clay), 'Thu, Oct 8, 2026: clay 4 of 4, anti-goal');
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
  const grid = buildCategoryGrid(log, writing, {
    start: '2026-10-01',
    weeks: 2,
    today: '2026-10-06',
  });
  assert.equal(grid.longest, 2);
  assert.equal(grid.streak, 1);
  assert.equal(grid.activeDays, 4);
  assert.equal(grid.recordedDays, 5);
});

test('an unlogged today does not break the streak; an unlogged yesterday does', () => {
  const log = normalizeLog([entry('2026-10-06', { clay: 2 }), entry('2026-10-07', { clay: 4 })]);
  const open = buildCategoryGrid(log, clay, { start: '2026-10-05', weeks: 1, today: '2026-10-08' });
  assert.equal(open.streak, 2, 'today is still open');
  const closed = buildCategoryGrid(log, clay, {
    start: '2026-10-05',
    weeks: 1,
    today: '2026-10-09',
  });
  assert.equal(closed.streak, 0, 'yesterday was skipped');
  assert.equal(closed.longest, 2);
});

test('future entries are not scored even if present', () => {
  const log = normalizeLog([entry('2026-10-09', { writing: 4 })]);
  const grid = buildCategoryGrid(log, writing, {
    start: '2026-10-05',
    weeks: 1,
    today: '2026-10-08',
  });
  const f = grid.days.find((d) => d.date === '2026-10-09')!;
  assert.equal(f.future, true);
  assert.equal(f.count, 4, 'the data is still shown');
  assert.equal(grid.activeDays, 0, 'but not counted');
});

test('month boundaries and a leap day', () => {
  // 2028 is a leap year. 2028-02-28 is a Monday.
  const log = normalizeLog([
    entry('2028-02-29', { writing: 2 }),
    entry('2028-03-01', { writing: 1 }),
  ]);
  const grid = buildCategoryGrid(log, writing, {
    start: '2028-02-28',
    weeks: 6,
    today: '2028-04-30',
  });
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
  assert.equal(grid.activeDays, 2);
  assert.equal(grid.longest, 2);
});

test('month labels keep their distance', () => {
  // 2026-09-01 is a Tuesday: the grid opens on Mon 08-31, a lone August week.
  const grid = buildCategoryGrid(normalizeLog([]), writing, {
    start: '2026-09-01',
    weeks: 10,
    today: '2026-10-08',
  });
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
  const grid = buildCategoryGrid(normalizeLog([]), writing, {
    start: '2026-12-28',
    weeks: 2,
    today: '2027-01-20',
  });
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
    buildCategoryGrid(normalizeLog([]), writing, {
      start: '2026-13-01',
      weeks: 1,
      today: '2026-10-08',
    }),
  );
});
