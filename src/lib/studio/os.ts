/**
 * os — the warm little desktop that lives on the in-world monitor.
 *
 * It reads a manifest (built at build time from Ben's real content and inlined
 * into the encrypted HTML) and the matching pre-rendered entry bodies out of a
 * hidden store in the page, and renders a clickable desktop: app icons open
 * windows, windows list a section's entries, and opening an entry pulls its full
 * pre-rendered HTML into a scrollable reader — all read entirely in-world.
 *
 * The Fullscreen control calls the real Fullscreen API on the OS container, so
 * the in-world computer takes over the actual monitor. No content is fetched:
 * every word already sits inline in the page.
 */

export interface OSEntry {
  title: string;
  date: string;
  meta?: string;
  summary?: string;
  bodyId: string;
}

export interface OSApp {
  key: string;
  label: string;
  kind: 'collection' | 'doc';
  icon: string; // emoji glyph
  accent: string; // css colour var
  entries?: OSEntry[]; // for collections
  bodyId?: string; // for docs
  empty?: string; // message when a collection has no entries
}

export interface OSManifest {
  apps: OSApp[];
}

export interface OSOptions {
  os: HTMLElement;
  screen: HTMLElement;
  manifest: OSManifest;
  getBody: (bodyId: string) => string;
  onStepBack: () => void;
}

export interface OSHandle {
  open: (appKey?: string) => void;
  destroy: () => void;
  isFullscreen: () => boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function createOS(opts: OSOptions): OSHandle {
  const { os, screen, manifest, getBody, onStepBack } = opts;

  screen.textContent = '';
  screen.classList.add('os-screen');

  // --- Desktop surface -------------------------------------------------------
  const desktop = el('div', 'os-desktop');
  const icons = el('div', 'os-icons');
  desktop.appendChild(icons);
  screen.appendChild(desktop);

  const windowsLayer = el('div', 'os-windows');
  screen.appendChild(windowsLayer);

  // --- Taskbar ---------------------------------------------------------------
  const taskbar = el('div', 'os-taskbar');
  const brand = el('div', 'os-brand');
  brand.append(el('span', 'os-brand-dot'), el('span', undefined, "Ben's Studio"));
  const spacer = el('div', 'os-spacer');
  const clock = el('div', 'os-clock');
  const fsBtn = el('button', 'os-tb-btn');
  fsBtn.type = 'button';
  fsBtn.textContent = 'Fullscreen';
  const backBtn = el('button', 'os-tb-btn os-tb-back');
  backBtn.type = 'button';
  backBtn.textContent = 'Step back';
  taskbar.append(brand, spacer, clock, fsBtn, backBtn);
  screen.appendChild(taskbar);

  const setClock = () => {
    clock.textContent = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date());
  };
  setClock();
  const clockTimer = window.setInterval(setClock, 20000);

  // --- Window management ------------------------------------------------------
  let zTop = 10;
  let cascade = 0;
  const openWindows = new Map<string, HTMLElement>();

  const focusWindow = (win: HTMLElement) => {
    zTop += 1;
    win.style.zIndex = String(zTop);
  };

  const makeDraggable = (win: HTMLElement, handle: HTMLElement) => {
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    let dragging = false;
    const down = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('.os-win-close')) return;
      dragging = true;
      focusWindow(win);
      sx = e.clientX;
      sy = e.clientY;
      ox = win.offsetLeft;
      oy = win.offsetTop;
      handle.setPointerCapture(e.pointerId);
      win.classList.add('is-dragging');
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      const rect = screen.getBoundingClientRect();
      const nx = Math.max(0, Math.min(rect.width - 40, ox + (e.clientX - sx)));
      const ny = Math.max(0, Math.min(rect.height - 30, oy + (e.clientY - sy)));
      win.style.left = `${nx}px`;
      win.style.top = `${ny}px`;
    };
    const up = (e: PointerEvent) => {
      dragging = false;
      win.classList.remove('is-dragging');
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch {
        /* released */
      }
    };
    handle.addEventListener('pointerdown', down);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const openWindow = (id: string, title: string, accent: string): HTMLElement => {
    const existing = openWindows.get(id);
    if (existing) {
      focusWindow(existing);
      return existing.querySelector('.os-win-body') as HTMLElement;
    }
    const win = el('div', 'os-win');
    win.style.setProperty('--accent', accent);
    cascade = (cascade + 1) % 6;
    win.style.left = `${8 + cascade * 4}%`;
    win.style.top = `${6 + cascade * 5}%`;

    const header = el('div', 'os-win-header');
    const titleEl = el('span', 'os-win-title', title);
    const close = el('button', 'os-win-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close window');
    close.textContent = '×';
    close.addEventListener('click', () => {
      win.remove();
      openWindows.delete(id);
    });
    header.append(titleEl, close);

    const body = el('div', 'os-win-body');
    win.append(header, body);
    win.addEventListener('pointerdown', () => focusWindow(win));
    windowsLayer.appendChild(win);
    makeDraggable(win, header);
    focusWindow(win);
    openWindows.set(id, win);
    return body;
  };

  const openReader = (entry: OSEntry, accent: string) => {
    const body = openWindow(`reader:${entry.bodyId}`, entry.title, accent);
    body.textContent = '';
    body.classList.add('os-reader');
    const head = el('header', 'os-reader-head');
    if (entry.meta) head.appendChild(el('p', 'os-reader-kicker', entry.meta));
    head.appendChild(el('h1', undefined, entry.title));
    if (entry.summary) head.appendChild(el('p', 'os-reader-lede', entry.summary));
    if (entry.date) head.appendChild(el('p', 'os-reader-date', entry.date));
    const article = el('div', 'os-prose');
    article.innerHTML = getBody(entry.bodyId);
    body.append(head, article);
    body.scrollTop = 0;
  };

  const openCollection = (app: OSApp) => {
    const body = openWindow(`app:${app.key}`, app.label, app.accent);
    body.textContent = '';
    body.classList.add('os-list');
    const entries = app.entries ?? [];
    if (entries.length === 0) {
      body.appendChild(el('p', 'os-empty', app.empty ?? 'Nothing here yet.'));
      return;
    }
    for (const entry of entries) {
      const row = el('button', 'os-row');
      row.type = 'button';
      const top = el('div', 'os-row-top');
      top.append(el('span', 'os-row-title', entry.title), el('span', 'os-row-date', entry.date));
      row.appendChild(top);
      if (entry.summary) row.appendChild(el('p', 'os-row-sum', entry.summary));
      row.addEventListener('click', () => openReader(entry, app.accent));
      body.appendChild(row);
    }
  };

  const openApp = (app: OSApp) => {
    if (app.kind === 'doc' && app.bodyId) {
      openReader(
        { title: app.label, date: '', bodyId: app.bodyId, meta: app.label },
        app.accent,
      );
    } else {
      openCollection(app);
    }
  };

  // --- Icons -----------------------------------------------------------------
  for (const app of manifest.apps) {
    const icon = el('button', 'os-icon');
    icon.type = 'button';
    icon.style.setProperty('--accent', app.accent);
    const glyph = el('span', 'os-icon-glyph', app.icon);
    const label = el('span', 'os-icon-label', app.label);
    icon.append(glyph, label);
    icon.addEventListener('click', () => openApp(app));
    icons.appendChild(icon);
  }

  // --- Fullscreen ------------------------------------------------------------
  const fsTarget = os;
  const onFsChange = () => {
    const active = document.fullscreenElement === fsTarget;
    os.classList.toggle('is-fullscreen', active);
    fsBtn.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
  };
  document.addEventListener('fullscreenchange', onFsChange);
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement === fsTarget) {
      document.exitFullscreen?.();
    } else {
      // Must run inside this click (user gesture) for the request to be granted.
      fsTarget.requestFullscreen?.().catch(() => {
        /* browser refused fullscreen; stay in the projected view */
      });
    }
  });

  backBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    onStepBack();
  });

  const destroy = () => {
    window.clearInterval(clockTimer);
    document.removeEventListener('fullscreenchange', onFsChange);
    if (document.fullscreenElement === fsTarget) document.exitFullscreen?.().catch(() => {});
    screen.textContent = '';
    openWindows.clear();
  };

  return {
    open: (appKey?: string) => {
      if (appKey) {
        const app = manifest.apps.find((a) => a.key === appKey);
        if (app) openApp(app);
      }
    },
    destroy,
    isFullscreen: () => document.fullscreenElement === fsTarget,
  };
}
