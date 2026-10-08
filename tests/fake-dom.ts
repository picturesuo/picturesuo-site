/**
 * The smallest DOM the check-in controller touches, so a node test can mount
 * the page and drive it through the same handlers a phone would: taps are
 * clicks, typing is an input event, and a pending GitHub read is a promise
 * the test releases when it chooses.
 */

export class FakeEvent {
  type: string;
  defaultPrevented = false;
  constructor(type: string) {
    this.type = type;
  }
  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

type Listener = (ev: FakeEvent) => void;

interface Compound {
  tag?: string;
  classes: string[];
  attrs: Array<[string, string | null]>;
}

function parseCompound(s: string): Compound {
  const m = s.trim().match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*)$/);
  if (!m) throw new Error(`unsupported selector: ${s}`);
  const out: Compound = { tag: m[1]?.toUpperCase(), classes: [], attrs: [] };
  for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
    if (part.startsWith('.')) out.classes.push(part.slice(1));
    else {
      const a = part.slice(1, -1).match(/^([\w-]+)(?:="([^"]*)")?$/);
      if (!a) throw new Error(`unsupported selector: ${s}`);
      out.attrs.push([a[1], a[2] ?? null]);
    }
  }
  return out;
}

export class FakeElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  classes = new Set<string>();
  dataset: Record<string, string>;
  style: Record<string, string> & { setProperty: (name: string, value: string) => void };
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  open = false;
  type = '';
  title = '';
  scrollHeight = 0;
  private text = '';
  private html = '';
  private listeners = new Map<string, Listener[]>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
    const attrs = this.attributes;
    this.dataset = new Proxy({} as Record<string, string>, {
      get: (_, key) => attrs.get(`data-${String(key)}`),
      set: (_, key, v) => {
        attrs.set(`data-${String(key)}`, String(v));
        return true;
      },
    });
    const style: Record<string, string> = {};
    this.style = Object.assign(style, {
      setProperty(name: string, value: string) {
        style[name] = value;
      },
    });
  }

  get classList() {
    const classes = this.classes;
    return {
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !classes.has(c);
        if (on) classes.add(c);
        else classes.delete(c);
        return on;
      },
    };
  }

  get className(): string {
    return [...this.classes].join(' ');
  }
  set className(v: string) {
    this.classes = new Set(v.split(/\s+/).filter(Boolean));
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [];
    this.html = '';
    this.text = v;
  }
  get innerHTML(): string {
    return this.html;
  }
  set innerHTML(v: string) {
    this.children = [];
    this.text = '';
    this.html = v;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  matches(selector: string): boolean {
    return selector.split(',').some((part) => {
      const c = parseCompound(part);
      if (c.tag && c.tag !== this.tagName) return false;
      if (!c.classes.every((k) => this.classes.has(k))) return false;
      return c.attrs.every(([name, v]) =>
        v === null ? this.attributes.has(name) : this.attributes.get(name) === v,
      );
    });
  }

  querySelectorAll<T extends FakeElement = FakeElement>(selector: string): T[] {
    const out: T[] = [];
    const walk = (el: FakeElement) => {
      for (const c of el.children) {
        if (c.matches(selector)) out.push(c as T);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector<T extends FakeElement = FakeElement>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null;
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatch(type: string): FakeEvent {
    const ev = new FakeEvent(type);
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
    return ev;
  }
  click(): void {
    if (this.disabled) return;
    if (this.tagName === 'INPUT' && this.type === 'checkbox') {
      this.checked = !this.checked;
      this.dispatch('change');
    }
    this.dispatch('click');
  }
  focus(): void {}
}

/** Install `document`, `window` and `localStorage` for one test; returns the undo. */
export function installDom(storage: Record<string, string> = {}): () => void {
  const store = new Map(Object.entries(storage));
  const listeners = new FakeElement('document');
  const globals: Record<string, unknown> = {
    document: {
      visibilityState: 'visible',
      createElement: (tag: string) => new FakeElement(tag),
      addEventListener: (type: string, fn: Listener) => listeners.addEventListener(type, fn),
    },
    window: {
      addEventListener: (type: string, fn: Listener) => listeners.addEventListener(type, fn),
    },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries(globals)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [name, desc] of previous) {
      if (desc) Object.defineProperty(globalThis, name, desc);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  };
}
