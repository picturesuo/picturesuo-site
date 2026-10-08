import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commitMessage,
  isBlank,
  localDate,
  makeEntry,
  mergePrivateNote,
  noteBody,
  parseLog,
  privateNote,
  privateNotePath,
  recentDays,
  serializeLog,
  shiftDate,
  streak,
  upsert,
  type Entry,
} from '../src/lib/today/core.ts';

const day = (date: string, writing = 1): Entry => ({
  date,
  writing,
  tech: 0,
  clay: 0,
  photos: 0,
  posts: 0,
  flag: false,
});

test('localDate is the local calendar day, not UTC', () => {
  // 23:30 local on the 6th is a different UTC day in most of the Americas.
  const d = new Date(2026, 9, 6, 23, 30);
  assert.equal(localDate(d), '2026-10-06');
});

test('shiftDate crosses month and year boundaries', () => {
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30');
  assert.equal(shiftDate('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});

test('an explicit all-zero day is recorded and counts as logged', () => {
  const zero = makeEntry(
    '2026-10-07',
    { writing: 0, tech: 0, clay: 0, photos: 0, posts: 0 },
    false,
  );
  const log = upsert([day('2026-10-06')], zero);
  assert.equal(log.length, 2);
  assert.equal(streak(log, '2026-10-07'), 2);
  assert.equal(recentDays(log, '2026-10-07', 2)[1].entry, zero);
});

test('isBlank tells an all-zero, unflagged day from one with something in it', () => {
  assert.equal(isBlank(day('2026-10-06', 0)), true);
  assert.equal(isBlank({ ...day('2026-10-06', 0), flag: true }), false);
  assert.equal(isBlank(day('2026-10-06', 1)), false);
});

test('makeEntry validates the range and the date', () => {
  assert.throws(() =>
    makeEntry('2026-10-06', { writing: 5, tech: 0, clay: 0, photos: 0, posts: 0 }, false),
  );
  assert.throws(() =>
    makeEntry('2026-13-06', { writing: 1, tech: 0, clay: 0, photos: 0, posts: 0 }, false),
  );
  const e = makeEntry('2026-10-06', { writing: 3, tech: 2, clay: 0, photos: 1, posts: 1 }, true);
  assert.deepEqual(e, {
    date: '2026-10-06',
    writing: 3,
    tech: 2,
    clay: 0,
    photos: 1,
    posts: 1,
    flag: true,
  });
});

test('upsert keeps every other day untouched, replaces the same day, and sorts', () => {
  const log = [day('2026-10-01'), day('2026-10-03', 2)];
  const next = upsert(log, day('2026-10-02'));
  assert.deepEqual(
    next.map((e) => e.date),
    ['2026-10-01', '2026-10-02', '2026-10-03'],
  );
  assert.equal(next[2].writing, 2);
  const replaced = upsert(next, day('2026-10-03', 4));
  assert.equal(replaced.length, 3);
  assert.equal(replaced[2].writing, 4);
  // the input is not mutated
  assert.equal(log.length, 2);
});

test('upsert never backfills: the gap between logged days stays a gap', () => {
  const next = upsert([day('2026-10-01')], day('2026-10-05'));
  assert.deepEqual(
    next.map((e) => e.date),
    ['2026-10-01', '2026-10-05'],
  );
});

test('serializeLog matches the byte shape counts:export writes', () => {
  const text = serializeLog([day('2026-10-01')]);
  assert.equal(
    text,
    '[\n {\n  "date": "2026-10-01",\n  "writing": 1,\n  "tech": 0,\n  "clay": 0,\n  "photos": 0,\n  "posts": 0,\n  "flag": false\n }\n]\n',
  );
  assert.deepEqual(parseLog(text), [day('2026-10-01')]);
});

test('parseLog rejects a wrong shape loudly', () => {
  assert.throws(() => parseLog('{}'));
  assert.throws(() => parseLog('[{"writing":1}]'));
  assert.deepEqual(parseLog('[]'), []);
});

test('recentDays ends on today, oldest first, with nulls for the holes', () => {
  const log = [day('2026-10-05'), day('2026-10-07')];
  const days = recentDays(log, '2026-10-07', 4);
  assert.deepEqual(
    days.map((d) => [d.date, d.entry !== null]),
    [
      ['2026-10-04', false],
      ['2026-10-05', true],
      ['2026-10-06', false],
      ['2026-10-07', true],
    ],
  );
});

test('streak survives the morning before today is logged', () => {
  const log = [day('2026-10-04'), day('2026-10-05'), day('2026-10-06')];
  assert.equal(streak(log, '2026-10-07'), 3); // today not logged yet
  assert.equal(streak(upsert(log, day('2026-10-07')), '2026-10-07'), 4);
  assert.equal(streak(log, '2026-10-08'), 0); // yesterday missing: it is over
  assert.equal(streak([], '2026-10-08'), 0);
});

test('the private note carries the counts and the line, and has a stable path', () => {
  const e = makeEntry('2026-10-06', { writing: 2, tech: 0, clay: 1, photos: 0, posts: 0 }, false);
  assert.equal(privateNotePath('2026-10-06'), 'checkins/2026-10-06.md');
  const text = privateNote(e, '  threw two bowls, both slumped  ');
  assert.match(text, /^---\ndate: 2026-10-06\nprivate: true\nwriting: 2\n/);
  assert.match(text, /\nflag: false\n---\n\n# 2026-10-06\n\nthrew two bowls, both slumped\n$/);
  assert.match(privateNote(e, ''), /_No note\._\n$/);
});

test('noteBody reads the line back out of a private note', () => {
  const e = makeEntry('2026-10-06', { writing: 2, tech: 0, clay: 1, photos: 0, posts: 0 }, false);
  assert.equal(noteBody(privateNote(e, 'threw two bowls')), 'threw two bowls');
  assert.equal(noteBody(privateNote(e, '')), '');
  assert.equal(noteBody('just words, no front matter\n'), 'just words, no front matter');
});

test('updating the counts with a blank field keeps the saved line', () => {
  const morning = makeEntry(
    '2026-10-07',
    { writing: 1, tech: 0, clay: 0, photos: 0, posts: 0 },
    false,
  );
  const saved = mergePrivateNote(morning, 'threw two bowls', null);
  const evening = makeEntry(
    '2026-10-07',
    { writing: 2, tech: 0, clay: 0, photos: 0, posts: 0 },
    true,
  );
  const updated = mergePrivateNote(evening, '', saved);
  assert.match(updated, /\nwriting: 2\n/);
  assert.match(updated, /\nflag: true\n/);
  assert.match(updated, /\n\nthrew two bowls\n$/);
  assert.match(mergePrivateNote(evening, '  glazed instead  ', saved), /\n\nglazed instead\n$/);
  assert.match(mergePrivateNote(evening, '', null), /_No note\._\n$/);
});

test('a blank field keeps a hand-edited multi-line note verbatim', () => {
  const morning = makeEntry(
    '2026-10-07',
    { writing: 1, tech: 0, clay: 0, photos: 0, posts: 0 },
    false,
  );
  const edited = mergePrivateNote(morning, 'threw two bowls', null).replace(
    'threw two bowls',
    'threw two bowls\n\nboth slumped',
  );
  const evening = makeEntry(
    '2026-10-07',
    { writing: 2, tech: 0, clay: 0, photos: 0, posts: 0 },
    false,
  );
  const updated = mergePrivateNote(evening, '', edited);
  assert.match(updated, /\nwriting: 2\n/);
  assert.ok(updated.endsWith('\n\nthrew two bowls\n\nboth slumped\n'));
  assert.equal(noteBody(updated), 'threw two bowls\n\nboth slumped');
});

test('commit messages name the day and whether it is a correction', () => {
  assert.equal(commitMessage('2026-10-06', false), 'Log 2026-10-06');
  assert.equal(commitMessage('2026-10-06', true), 'Update 2026-10-06');
});
