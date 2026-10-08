import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GitHubError,
  checkAccess,
  decodeBase64,
  encodeBase64,
  getFile,
  updateFile,
  type FetchLike,
  type Repo,
} from '../src/lib/today/github.ts';

const repo: Repo = { owner: 'o', repo: 'r', branch: 'main' };

/**
 * A fake GitHub that behaves like the Contents API where it matters: GET
 * returns base64 and a blob SHA, PUT demands the current SHA and answers 409
 * when it is stale, and every PUT makes a new SHA.
 */
function fakeGitHub(initial: string | null) {
  const state = {
    text: initial,
    sha: initial ? 'sha0' : '',
    puts: 0,
    gets: 0,
    commits: [] as string[],
  };
  let n = 0;
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch: FetchLike = async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      state.gets++;
      if (state.text === null) return json(404, { message: 'Not Found' });
      return json(200, { type: 'file', content: encodeBase64(state.text), sha: state.sha });
    }
    if (method === 'PUT') {
      state.puts++;
      const body = JSON.parse(String(init?.body)) as {
        sha?: string;
        content: string;
        message: string;
      };
      if (state.text !== null && body.sha !== state.sha) {
        return json(409, { message: `${url} does not match ${state.sha}` });
      }
      if (state.text === null && body.sha) return json(422, { message: 'sha for a new file' });
      state.text = decodeBase64(body.content);
      state.sha = `sha${++n}`;
      state.commits.push(body.message);
      return json(state.puts === 1 && !body.sha ? 201 : 200, {
        commit: { sha: `commit${n}` },
        content: { sha: state.sha },
      });
    }
    return json(405, {});
  };
  return { state, fetch };
}

test('base64 round-trips unicode', () => {
  const s = 'threw two bowls - both slumped · “ok”';
  assert.equal(decodeBase64(encodeBase64(s)), s);
});

test('getFile decodes content and returns null for a missing file', async () => {
  const gh = fakeGitHub('[]\n');
  assert.deepEqual(await getFile(gh.fetch, 't', repo, 'f'), { text: '[]\n', sha: 'sha0' });
  const empty = fakeGitHub(null);
  assert.equal(await getFile(empty.fetch, 't', repo, 'f'), null);
});

test('updateFile creates a new file without a sha', async () => {
  const gh = fakeGitHub(null);
  const r = await updateFile({
    fetch: gh.fetch,
    token: 't',
    repo,
    path: 'checkins/2026-10-06.md',
    message: 'Log 2026-10-06',
    transform: (cur) => {
      assert.equal(cur, null);
      return 'note\n';
    },
  });
  assert.equal(r.status, 'committed');
  assert.equal(gh.state.text, 'note\n');
});

test('updateFile sends the current sha and reports the commit', async () => {
  const gh = fakeGitHub('a\n');
  const r = await updateFile({
    fetch: gh.fetch,
    token: 't',
    repo,
    path: 'f',
    message: 'm',
    transform: (cur) => `${cur}b\n`,
  });
  assert.equal(r.status, 'committed');
  if (r.status === 'committed') assert.equal(r.commitSha, 'commit1');
  assert.equal(gh.state.text, 'a\nb\n');
  assert.deepEqual(gh.state.commits, ['m']);
});

test('updateFile skips the write when the result is already there (safe retry)', async () => {
  const gh = fakeGitHub('same\n');
  const r = await updateFile({
    fetch: gh.fetch,
    token: 't',
    repo,
    path: 'f',
    message: 'm',
    transform: () => 'same\n',
  });
  assert.equal(r.status, 'unchanged');
  assert.equal(gh.state.puts, 0);
});

test('updateFile re-reads and re-applies after a concurrent edit, losing nothing', async () => {
  const gh = fakeGitHub('["theirs-1"]');
  let raced = false;
  const fetch: FetchLike = async (url, init) => {
    // Someone else commits between our GET and our first PUT.
    if ((init?.method ?? 'GET') === 'PUT' && !raced) {
      raced = true;
      gh.state.text = '["theirs-1","theirs-2"]';
      gh.state.sha = 'sha-theirs';
    }
    return gh.fetch(url, init);
  };
  const r = await updateFile({
    fetch,
    token: 't',
    repo,
    path: 'f',
    message: 'm',
    transform: (cur) => JSON.stringify([...(JSON.parse(cur ?? '[]') as string[]), 'mine']),
  });
  assert.equal(r.status, 'committed');
  assert.equal(gh.state.text, '["theirs-1","theirs-2","mine"]');
  assert.equal(gh.state.puts, 2);
});

test('updateFile gives up after repeated conflicts with a clear error', async () => {
  const gh = fakeGitHub('x');
  const fetch: FetchLike = async (url, init) => {
    if ((init?.method ?? 'GET') === 'PUT') gh.state.sha = `moved-${Math.random()}`;
    return gh.fetch(url, init);
  };
  await assert.rejects(
    updateFile({
      fetch,
      token: 't',
      repo,
      path: 'f',
      message: 'm',
      transform: () => 'y',
      attempts: 2,
    }),
    (e: unknown) => e instanceof GitHubError && /changed under us 2 times/.test(e.message),
  );
  assert.equal(gh.state.text, 'x');
});

test('errors name the cause in plain words', async () => {
  const fetch: FetchLike = async () =>
    new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
  await assert.rejects(
    getFile(fetch, 'bad', repo, 'f'),
    (e: unknown) =>
      e instanceof GitHubError &&
      e.status === 401 &&
      /rejected the token: Bad credentials/.test(e.message),
  );
});

test('checkAccess reads the branch and whether the repo is private', async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    if (url.endsWith('/branches/main')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({ private: true }), { status: 200 });
  };
  assert.deepEqual(await checkAccess(fetch, 't', repo), { private: true });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].endsWith('/repos/o/r/branches/main'));
});
