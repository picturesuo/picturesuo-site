/**
 * The check-in page's controller. One screen, one job: five taps, a tick,
 * maybe a line, Save. The counts go to the public repo's log.json; the whole
 * record including the line goes to the private life-log repo. Nothing here
 * touches a server of its own - the phone talks to GitHub directly, with a
 * token that lives only in this browser's localStorage.
 */
import {
  TRACKS,
  TRACK_LABELS,
  type Counts,
  type Entry,
  type Track,
  byDate,
  commitMessage,
  formatDate,
  isBlank,
  localDate,
  makeEntry,
  parseLog,
  privateNote,
  privateNotePath,
  recentDays,
  serializeLog,
  shiftDate,
  streak,
  total,
  upsert,
} from './core';
import { GitHubError, checkAccess, getFile, updateFile, type Repo } from './github';

const STORAGE_KEY = 'picturesuo.today';
const LOG_PATH = 'src/data/log.json';

export interface Config {
  public: Repo;
  private: Repo;
  /** The public site's calendar page, for the "see it" link. */
  progressHref: string;
}

interface Stored {
  token: string;
  savedAt: string;
  /** Optional, typed in by hand - the API does not expose it to a browser. */
  expires?: string;
  branch?: string;
}

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    return s && typeof s.token === 'string' && s.token ? s : null;
  } catch {
    return null;
  }
}

function writeStored(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode, or storage blocked: the page still works for one session */
  }
}

const TRACK_COLORS: Record<Track, string> = {
  writing: 'var(--green)',
  tech: 'var(--blue)',
  clay: 'var(--coral)',
  photos: 'var(--amber)',
  posts: 'var(--plum)',
};

function q<T extends Element>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
}

export function mount(root: HTMLElement, config: Config, initialLog: Entry[]): void {
  const fetchFn = (input: string, init?: RequestInit) => fetch(input, init);
  let log = initialLog;
  let today = localDate();
  let day = today;
  const counts: Counts = { writing: 0, tech: 0, clay: 0, photos: 0, posts: 0 };
  let flag = false;
  let saving = false;

  const els = {
    streak: q<HTMLElement>(root, '[data-streak]'),
    strip: q<HTMLElement>(root, '[data-strip]'),
    source: q<HTMLElement>(root, '[data-source]'),
    gap: q<HTMLElement>(root, '[data-gap]'),
    gapText: q<HTMLElement>(root, '[data-gap-text]'),
    gapButton: q<HTMLButtonElement>(root, '[data-gap-button]'),
    dayButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-day]')),
    dayLabel: q<HTMLElement>(root, '[data-day-label]'),
    form: q<HTMLFormElement>(root, '[data-form]'),
    rows: q<HTMLElement>(root, '[data-rows]'),
    flag: q<HTMLInputElement>(root, '[data-flag]'),
    note: q<HTMLInputElement>(root, '[data-note]'),
    save: q<HTMLButtonElement>(root, '[data-save]'),
    status: q<HTMLElement>(root, '[data-status]'),
    setup: q<HTMLDetailsElement>(root, '[data-setup]'),
    setupState: q<HTMLElement>(root, '[data-setup-state]'),
    tokenForm: q<HTMLFormElement>(root, '[data-token-form]'),
    token: q<HTMLInputElement>(root, '[data-token]'),
    expires: q<HTMLInputElement>(root, '[data-expires]'),
    branch: q<HTMLInputElement>(root, '[data-branch]'),
    tokenStatus: q<HTMLElement>(root, '[data-token-status]'),
    forget: q<HTMLButtonElement>(root, '[data-forget]'),
  };

  // ---- the five rows of tap targets -------------------------------------
  els.rows.innerHTML = '';
  for (const t of TRACKS) {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', TRACK_LABELS[t]);
    row.dataset.track = t;
    const label = document.createElement('span');
    label.className = 'row-label';
    label.innerHTML = `<i class="sw" style="background:${TRACK_COLORS[t]}"></i>${TRACK_LABELS[t]}`;
    row.appendChild(label);
    const taps = document.createElement('div');
    taps.className = 'taps';
    for (let n = 0; n <= 4; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tap';
      b.textContent = String(n);
      b.dataset.n = String(n);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', n === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        counts[t] = n;
        paintRow(t);
        paintSave();
      });
      taps.appendChild(b);
    }
    row.appendChild(taps);
    els.rows.appendChild(row);
  }

  function paintRow(t: Track): void {
    const row = els.rows.querySelector<HTMLElement>(`[data-track="${t}"]`);
    if (!row) return;
    row.querySelectorAll<HTMLButtonElement>('.tap').forEach((b) => {
      const on = Number(b.dataset.n) === counts[t];
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.style.setProperty('--c', TRACK_COLORS[t]);
    });
  }

  function paintSave(): void {
    const existing = byDate(log).get(day);
    // An all-zero day is still a day you showed up to record: it is logged
    // as a zero day, deliberately. What never happens is the page writing a
    // zero row for a day you skipped.
    const zero = isBlank({ ...counts, flag }) ? ' as a zero day' : '';
    els.save.disabled = saving;
    els.save.textContent = saving
      ? 'Saving…'
      : existing
        ? `Update ${formatDate(day)}${zero}`
        : `Save ${formatDate(day)}${zero}`;
  }

  // ---- the top: streak, 14 days, the hole -------------------------------
  function paintTop(): void {
    const s = streak(log, today);
    els.streak.innerHTML =
      s > 0
        ? `<b>${s}</b> day${s === 1 ? '' : 's'} running`
        : `<b>0</b> days running · nothing logged lately`;

    const days = recentDays(log, today, 14);
    els.strip.innerHTML = '';
    for (const d of days) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.date = d.date;
      const e = d.entry;
      const tot = e ? total(e) : 0;
      // The bands live in their own absolutely positioned box: a percentage
      // height inside a <button> does not resolve, inside this box it does.
      const fillBox = document.createElement('em');
      fillBox.className = 'fill';
      if (e && tot > 0) {
        const fill = Math.min(1, tot / 11);
        for (const t of TRACKS) {
          const v = e[t];
          if (!v) continue;
          const span = document.createElement('span');
          span.style.height = `${((v / tot) * fill * 100).toFixed(2)}%`;
          span.style.background = TRACK_COLORS[t];
          fillBox.appendChild(span);
        }
      }
      cell.appendChild(fillBox);
      cell.classList.toggle('flag', Boolean(e && e.flag));
      cell.classList.toggle('today', d.date === today);
      cell.classList.toggle('picked', d.date === day);
      cell.classList.toggle('empty', !e);
      const summary = e
        ? TRACKS.filter((t) => e[t])
            .map((t) => `${TRACK_LABELS[t].toLowerCase()} ${e[t]}`)
            .join(' · ') || 'anti-goal only'
        : 'not logged';
      cell.title = `${formatDate(d.date, { year: 'numeric' })} — ${summary}${e && e.flag ? ' · anti-goal' : ''}`;
      cell.setAttribute('aria-label', cell.title);
      const wd = document.createElement('i');
      wd.textContent = formatDate(d.date, { weekday: 'narrow', month: undefined, day: undefined });
      cell.appendChild(wd);
      // Only today and yesterday are editable here: the page is for the day
      // you are in, not for rewriting history from a phone.
      const editable = d.date === today || d.date === shiftDate(today, -1);
      cell.disabled = !editable;
      if (editable) cell.addEventListener('click', () => pickDay(d.date));
      els.strip.appendChild(cell);
    }

    const yesterday = shiftDate(today, -1);
    const missing = !byDate(log).has(yesterday);
    els.gap.hidden = !missing;
    if (missing) {
      els.gapText.textContent = `Yesterday, ${formatDate(yesterday)}, is not logged.`;
      els.gapButton.textContent = day === yesterday ? 'Logging yesterday' : 'Log yesterday too';
      els.gapButton.disabled = day === yesterday;
    }
  }

  function pickDay(date: string, keepStatus = false): void {
    day = date;
    const existing = byDate(log).get(day);
    for (const t of TRACKS) counts[t] = existing ? existing[t] : 0;
    flag = existing ? existing.flag : false;
    els.flag.checked = flag;
    els.note.value = '';
    for (const t of TRACKS) paintRow(t);
    els.dayButtons.forEach((b) => {
      const on = b.dataset.day === (date === today ? 'today' : 'yesterday');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    els.dayLabel.textContent = formatDate(day, { year: 'numeric' });
    if (!keepStatus) els.status.innerHTML = '';
    paintTop();
    paintSave();
  }

  els.dayButtons.forEach((b) =>
    b.addEventListener('click', () =>
      pickDay(b.dataset.day === 'today' ? today : shiftDate(today, -1)),
    ),
  );
  els.gapButton.addEventListener('click', () => pickDay(shiftDate(today, -1)));
  els.flag.addEventListener('change', () => {
    flag = els.flag.checked;
    paintSave();
  });

  // ---- live data ---------------------------------------------------------
  async function refresh(): Promise<void> {
    const stored = readStored();
    const repo = { ...config.public, branch: stored?.branch || config.public.branch };
    try {
      const f = await getFile(fetchFn, stored?.token ?? null, repo, LOG_PATH);
      if (f) {
        log = parseLog(f.text);
        els.source.textContent = `live from GitHub · ${repo.branch}`;
      }
    } catch (e) {
      els.source.textContent = `showing the last build (${e instanceof Error ? e.message : e})`;
    }
    today = localDate();
    if (day !== today && day !== shiftDate(today, -1)) day = today;
    pickDay(day);
  }

  // ---- saving ------------------------------------------------------------
  type StepResult = { label: string; ok: boolean; text: string; href?: string };

  function paintStatus(results: StepResult[], retry: boolean): void {
    els.status.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'steps';
    for (const r of results) {
      const li = document.createElement('li');
      li.className = r.ok ? 'ok' : 'bad';
      li.innerHTML = `<b>${r.label}</b> ${r.href ? `<a href="${r.href}">${r.text}</a>` : r.text}`;
      ul.appendChild(li);
    }
    els.status.appendChild(ul);
    if (retry) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent =
        'Saving is safe to repeat: a step that already landed is left alone, only the missing one is written.';
      els.status.appendChild(p);
    }
  }

  async function save(): Promise<void> {
    const stored = readStored();
    if (!stored) {
      els.setup.open = true;
      els.token.focus();
      els.status.innerHTML = '<p class="bad">No token on this device yet. Set one up below.</p>';
      return;
    }
    let entry: Entry;
    try {
      entry = makeEntry(day, counts, flag);
    } catch (e) {
      els.status.innerHTML = `<p class="bad">${e instanceof Error ? e.message : e}</p>`;
      return;
    }
    saving = true;
    paintSave();
    const branchOf = (r: Repo): Repo => ({ ...r, branch: stored.branch || r.branch });
    const pub = branchOf(config.public);
    const priv = branchOf(config.private);
    const replacing = byDate(log).has(entry.date);
    const message = commitMessage(entry.date, replacing);
    const results: StepResult[] = [];
    let failed = false;

    // 1. The counts, to the public calendar. This is the one that matters.
    try {
      let merged: Entry[] = log;
      const r = await updateFile({
        fetch: fetchFn,
        token: stored.token,
        repo: pub,
        path: LOG_PATH,
        message,
        transform: (current) => {
          merged = upsert(current ? parseLog(current) : [], entry);
          return serializeLog(merged);
        },
      });
      log = merged;
      results.push(
        r.status === 'committed'
          ? {
              label: 'Counts',
              ok: true,
              text: `committed ${r.commitSha.slice(0, 7)} to ${pub.owner}/${pub.repo}`,
              href: `https://github.com/${pub.owner}/${pub.repo}/commit/${r.commitSha}`,
            }
          : { label: 'Counts', ok: true, text: 'already on GitHub, nothing to change' },
      );
    } catch (e) {
      failed = true;
      results.push({ label: 'Counts', ok: false, text: describe(e) });
    }

    // 2. The whole record, note included, to the private repo.
    try {
      const path = privateNotePath(entry.date);
      const r = await updateFile({
        fetch: fetchFn,
        token: stored.token,
        repo: priv,
        path,
        message,
        transform: () => privateNote(entry, els.note.value),
      });
      results.push(
        r.status === 'committed'
          ? {
              label: 'Note',
              ok: true,
              text: `committed ${r.commitSha.slice(0, 7)} to the private repo`,
            }
          : { label: 'Note', ok: true, text: 'already in the private repo, nothing to change' },
      );
    } catch (e) {
      failed = true;
      results.push({ label: 'Note', ok: false, text: describe(e) });
    }

    saving = false;
    paintStatus(results, failed);
    if (!failed) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.innerHTML = `Logged. The <a href="${config.progressHref}">calendar</a> shows it after the next deploy, a couple of minutes from now.`;
      els.status.appendChild(p);
      // Keep the counts on screen - the strip now shows the day filled in -
      // and if yesterday was the hole we just filled, move on to today.
      paintTop();
      if (day !== today && !byDate(log).has(today)) pickDay(today, true);
      else paintSave();
    } else {
      paintTop();
      paintSave();
    }
  }

  function describe(e: unknown): string {
    if (e instanceof GitHubError) return e.message;
    if (e instanceof TypeError) return `could not reach GitHub (${e.message})`;
    return e instanceof Error ? e.message : String(e);
  }

  els.form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void save();
  });

  // ---- the token ---------------------------------------------------------
  function paintSetup(): void {
    const stored = readStored();
    if (!stored) {
      els.setup.open = true;
      els.setupState.textContent = 'No token on this device';
      els.forget.hidden = true;
      els.branch.value = config.public.branch;
      return;
    }
    const saved = new Date(stored.savedAt);
    let text = `Token saved on this device ${isNaN(saved.getTime()) ? '' : saved.toLocaleDateString()}`;
    if (stored.expires) {
      const days = Math.ceil((Date.parse(stored.expires) - Date.now()) / 86400000);
      text += days < 0 ? ` · expired ${-days} days ago` : ` · expires in ${days} days`;
      els.setupState.classList.toggle('bad', days < 7);
    }
    if (stored.branch && stored.branch !== config.public.branch)
      text += ` · branch ${stored.branch}`;
    els.setupState.textContent = text;
    els.forget.hidden = false;
    els.expires.value = stored.expires ?? '';
    els.branch.value = stored.branch || config.public.branch;
  }

  els.tokenForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const token = els.token.value.trim();
    if (!token) return;
    const branch = els.branch.value.trim() || config.public.branch;
    els.tokenStatus.textContent = 'Checking the token against both repositories…';
    els.tokenStatus.className = 'muted';
    try {
      await checkAccess(fetchFn, token, { ...config.public, branch });
      const priv = await checkAccess(fetchFn, token, { ...config.private, branch });
      if (!priv.private) throw new Error(`${config.private.repo} is not private - stop and check`);
    } catch (e) {
      els.tokenStatus.textContent = `Not saved: ${describe(e)}`;
      els.tokenStatus.className = 'bad';
      return;
    }
    writeStored({
      token,
      savedAt: new Date().toISOString(),
      expires: els.expires.value || undefined,
      branch: branch === config.public.branch ? undefined : branch,
    });
    els.token.value = '';
    els.tokenStatus.textContent = 'Saved. It stays in this browser only.';
    els.tokenStatus.className = 'ok';
    paintSetup();
    els.setup.open = false;
    void refresh();
  });

  els.forget.addEventListener('click', () => {
    writeStored(null);
    els.tokenStatus.textContent =
      'Forgotten on this device. Delete it on GitHub too if it might be exposed.';
    els.tokenStatus.className = 'muted';
    paintSetup();
  });

  // ---- go ----------------------------------------------------------------
  paintSetup();
  pickDay(today);
  void refresh();
}
