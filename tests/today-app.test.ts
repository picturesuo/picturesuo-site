import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeElement, installDom } from './fake-dom.ts';
import { mount, type Config } from '../src/lib/today/app.ts';
import { localDate, makeEntry, privateNote, serializeLog } from '../src/lib/today/core.ts';
import { encodeBase64 } from '../src/lib/today/github.ts';

const config: Config = {
  public: { owner: 'o', repo: 'site', branch: 'main' },
  private: { owner: 'o', repo: 'life-log', branch: 'main' },
  progressHref: '/progress/',
};

/** The hooks today.astro gives the controller, in the same nesting. */
function page(): FakeElement {
  const el = (tag: string, hook: string, parent: FakeElement, type = '') => {
    const e = parent.appendChild(new FakeElement(tag));
    e.setAttribute(hook, '');
    e.type = type;
    return e;
  };
  const root = new FakeElement('div');
  el('p', 'data-day-label', root);
  const top = root.appendChild(new FakeElement('section'));
  el('p', 'data-streak', top);
  el('div', 'data-strip', top);
  el('p', 'data-source', top);
  const gap = el('div', 'data-gap', top);
  el('p', 'data-gap-text', gap);
  el('button', 'data-gap-button', gap, 'button');
  const form = el('form', 'data-form', root);
  el('div', 'data-rows', form);
  el('input', 'data-flag', form, 'checkbox');
  el('textarea', 'data-note', form);
  el('button', 'data-save', form, 'submit');
  el('div', 'data-status', form);
  const setup = el('details', 'data-setup', root);
  el('em', 'data-setup-state', setup);
  const tokenForm = el('form', 'data-token-form', setup);
  el('input', 'data-token', tokenForm, 'password');
  el('p', 'data-token-status', tokenForm);
  el('button', 'data-forget', tokenForm, 'button');
  return root;
}

/** A GitHub whose private-repo reads wait until the test lets them answer. */
function github(publicText: string, privateText: string) {
  const held: Array<() => void> = [];
  const file = (text: string) =>
    new Response(JSON.stringify({ type: 'file', content: encodeBase64(text), sha: 'sha1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetch = (url: string): Promise<Response> =>
    url.includes('/repos/o/life-log/')
      ? new Promise((resolve) => held.push(() => resolve(file(privateText))))
      : Promise.resolve(file(publicText));
  return {
    fetch,
    held,
    async answerPrivate() {
      for (const release of held.splice(0)) release();
      await idle();
    },
  };
}

async function idle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

const tap = (root: FakeElement, track: string, n: number) =>
  root.querySelector(`[data-track="${track}"]`)!.querySelector(`[data-n="${n}"]`)!;
const chosen = (root: FakeElement, track: string) =>
  root.querySelector(`[data-track="${track}"]`)!.querySelector('.tap.on')!.dataset.n;

async function openLoggedDay(body: string) {
  const restore = installDom({
    'picturesuo.today': JSON.stringify({ token: 't', savedAt: '2026-10-08T07:00:00Z' }),
  });
  const entry = makeEntry(localDate(), { writing: 1, tech: 0, clay: 0, photos: 0, posts: 0 }, false);
  const gh = github(serializeLog([entry]), privateNote(entry, body));
  const realFetch = globalThis.fetch;
  globalThis.fetch = gh.fetch as typeof fetch;
  const root = page();
  mount(root as unknown as HTMLElement, config, [entry]);
  // The mount-time refresh reads the public log at once and re-seeds the
  // form; the private note is still on its way.
  await idle();
  assert.ok(gh.held.length > 0, 'the private note read is pending');
  return {
    root,
    gh,
    note: root.querySelector('[data-note]')!,
    done: () => {
      globalThis.fetch = realFetch;
      restore();
    },
  };
}

test('a count tapped before the private note arrives still gets the prefill', async () => {
  const body = 'threw two bowls\n\nboth slumped';
  const t = await openLoggedDay(body);
  try {
    tap(t.root, 'writing', 2).click();
    assert.equal(t.note.value, '');
    await t.gh.answerPrivate();
    assert.equal(t.note.value, body);
    assert.equal(chosen(t.root, 'writing'), '2');
    assert.match(t.root.querySelector('[data-save]')!.textContent, /^Update /);
  } finally {
    t.done();
  }
});

test('a line typed before the private note arrives is kept over the prefill', async () => {
  const t = await openLoggedDay('threw two bowls');
  try {
    t.note.value = 'kiln at six';
    t.note.dispatch('input');
    await t.gh.answerPrivate();
    assert.equal(t.note.value, 'kiln at six');
  } finally {
    t.done();
  }
});
