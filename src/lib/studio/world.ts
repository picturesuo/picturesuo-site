/**
 * world — the first-person controller for the studio.
 *
 * Boots the three.js scene, gives the player Minecraft-style movement
 * (pointer-lock mouse-look + WASD, with acceleration and a subtle head-bob),
 * keeps them inside the room and out of the furniture, and lets them "use" the
 * monitor: look at it and click / press E to ease into a seated view where the
 * in-world desktop (see os.ts) becomes a real, clickable HTML layer aligned to
 * the monitor. Esc / Step back stands you up again.
 *
 * three is imported statically here, so this whole module (plus three) is the
 * lazy chunk the page only loads when it decides to boot the world.
 */
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { buildRoom, type Hotspot } from './room';
import {
  createOS,
  createReaderPanel,
  type OSManifest,
  type OSHandle,
  type PanelHandle,
  type PanelDocSource,
} from './os';

export interface BootOptions {
  root: HTMLElement;
  plain: HTMLElement | null;
  manifest: OSManifest;
  canWalk: boolean;
}

type State = 'intro' | 'walking' | 'toComputer' | 'computer' | 'toStand' | 'panel';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export async function bootStudio(opts: BootOptions): Promise<() => void> {
  const { root, plain, manifest, canWalk } = opts;

  const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const worldEl = q<HTMLElement>('[data-world]');
  const canvas = q<HTMLCanvasElement>('[data-canvas]');
  const enterEl = q<HTMLElement>('[data-enter]');
  const hudEl = q<HTMLElement>('[data-hud]');
  const osEl = q<HTMLElement>('[data-os]');
  const osScreen = q<HTMLElement>('[data-os-screen]');
  const panelEl = q<HTMLElement>('[data-panel]');
  const useHintEl = q<HTMLElement>('[data-use-hint]');
  const store = q<HTMLElement>('[data-doc-store]');
  const getBody = (bodyId: string): string => {
    const node = store?.querySelector(`[data-body-id="${bodyId}"]`);
    return node ? node.innerHTML : '<p>Content unavailable.</p>';
  };

  // Reveal the world layer; hold the plain page underneath out of the a11y tree.
  worldEl.hidden = false;
  root.classList.add('is-world');
  if (plain) {
    plain.setAttribute('aria-hidden', 'true');
    plain.setAttribute('inert', '');
  }
  // Configure the enter overlay for this device's capabilities.
  root.classList.toggle('can-walk', canWalk);

  // --- Renderer / scene / camera ---------------------------------------------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Filmic tone mapping + sRGB output give the room a cohesive, warm golden-hour
  // look and keep the window highlights from blowing out to flat white.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 100);
  scene.add(camera);

  const room = buildRoom(scene);

  const EYE = 1.6;
  // Spawn standing in the room, looking toward the desk.
  camera.position.set(0.6, EYE, 1.9);
  camera.lookAt(0, 1.3, -3.2);

  const controls = new PointerLockControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.85;
  controls.minPolarAngle = Math.PI * 0.15;

  // --- Sizing -----------------------------------------------------------------
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (state === 'computer' && os && !os.isFullscreen()) projectOverlay();
  }

  // --- Overlay projection: place the HTML desktop on the monitor rectangle ----
  function projectOverlay() {
    const corners = room.getScreenCorners();
    const w = window.innerWidth;
    const h = window.innerHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      const p = c.clone().project(camera);
      const sx = (p.x * 0.5 + 0.5) * w;
      const sy = (-p.y * 0.5 + 0.5) * h;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    // Inset a touch so the desktop sits within the bezel, not over it.
    const insetX = (maxX - minX) * 0.02;
    const insetY = (maxY - minY) * 0.02;
    osEl.style.left = `${minX + insetX}px`;
    osEl.style.top = `${minY + insetY}px`;
    osEl.style.width = `${maxX - minX - insetX * 2}px`;
    osEl.style.height = `${maxY - minY - insetY * 2}px`;
  }

  // --- Movement ---------------------------------------------------------------
  const keys = new Set<string>();
  let curF = 0;
  let curR = 0;
  let bob = 0;
  const SPEED = 3.1;
  const ACCEL = 12;

  const raycaster = new THREE.Raycaster();
  const CENTER = new THREE.Vector2(0, 0);

  // Flatten every hotspot's meshes into one raycast list, remembering which
  // hotspot each mesh belongs to.
  const targetList: Array<{ mesh: THREE.Object3D; hs: Hotspot }> = [];
  for (const hs of room.hotspots) for (const t of hs.targets) targetList.push({ mesh: t, hs });
  const targetMeshes = targetList.map((t) => t.mesh);
  let activeHotspot: Hotspot | null = null;

  const setActiveHotspot = (hs: Hotspot | null) => {
    if (hs === activeHotspot) return;
    if (activeHotspot) activeHotspot.setHighlight(false);
    activeHotspot = hs;
    if (hs) {
      hs.setHighlight(true);
      useHintEl.textContent = '';
      const label = document.createElement('span');
      label.textContent = hs.label;
      const sep = document.createTextNode(' · click or ');
      const key = document.createElement('b');
      key.textContent = 'E';
      useHintEl.append(label, sep, key);
    }
    hudEl.classList.toggle('can-use', !!hs);
  };

  const pulseHotspots = (time: number) => {
    for (const hs of room.hotspots) hs.pulse(time);
  };

  function updateWalk(dt: number) {
    const inF = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const inR = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let tF = inF;
    let tR = inR;
    if (inF && inR) {
      const inv = 1 / Math.sqrt(2);
      tF *= inv;
      tR *= inv;
    }
    tF *= SPEED;
    tR *= SPEED;
    const k = 1 - Math.exp(-ACCEL * dt);
    curF += (tF - curF) * k;
    curR += (tR - curR) * k;

    if (Math.abs(curF) > 1e-4) controls.moveForward(curF * dt);
    if (Math.abs(curR) > 1e-4) controls.moveRight(curR * dt);

    // Room bounds + furniture collision (xz only).
    const p = camera.position;
    p.x = clamp(p.x, room.bounds.minX, room.bounds.maxX);
    p.z = clamp(p.z, room.bounds.minZ, room.bounds.maxZ);
    const R = 0.3;
    for (const b of room.colliders) {
      const minX = b.min.x - R;
      const maxX = b.max.x + R;
      const minZ = b.min.z - R;
      const maxZ = b.max.z + R;
      if (p.x > minX && p.x < maxX && p.z > minZ && p.z < maxZ) {
        const dl = p.x - minX;
        const dr = maxX - p.x;
        const dt2 = p.z - minZ;
        const db = maxZ - p.z;
        const m = Math.min(dl, dr, dt2, db);
        if (m === dl) p.x = minX;
        else if (m === dr) p.x = maxX;
        else if (m === dt2) p.z = minZ;
        else p.z = maxZ;
      }
    }

    // Subtle head-bob while actually moving.
    const speed = Math.hypot(curF, curR);
    bob += speed * dt * 2.4;
    p.y = EYE + (speed > 0.15 ? Math.sin(bob) * 0.035 : 0);
  }

  function checkHotspot() {
    raycaster.setFromCamera(CENTER, camera);
    const hits = raycaster.intersectObjects(targetMeshes, false);
    let found: Hotspot | null = null;
    if (hits.length) {
      const hit = hits[0];
      const entry = targetList.find((t) => t.mesh === hit.object);
      if (entry && hit.distance < entry.hs.reach) found = entry.hs;
    }
    setActiveHotspot(found);
  }

  // --- Camera easing ----------------------------------------------------------
  let ease: { startP: THREE.Vector3; endP: THREE.Vector3; startQ: THREE.Quaternion; endQ: THREE.Quaternion; t: number; dur: number; done: () => void } | null = null;
  const dummy = new THREE.Object3D();

  function animateTo(endP: THREE.Vector3, look: THREE.Vector3, dur: number, done: () => void) {
    dummy.position.copy(endP);
    dummy.up.set(0, 1, 0);
    dummy.lookAt(look);
    const endQ = dummy.quaternion.clone();

    // requestAnimationFrame is paused for hidden/backgrounded tabs, so a smooth
    // ease would never advance there. When we cannot animate, jump straight to
    // the end pose and finish synchronously — the transition just isn't smooth.
    if (document.hidden || dur <= 0) {
      camera.position.copy(endP);
      camera.quaternion.copy(endQ);
      ease = null;
      renderer.render(scene, camera);
      done();
      return;
    }

    ease = {
      startP: camera.position.clone(),
      endP: endP.clone(),
      startQ: camera.quaternion.clone(),
      endQ,
      t: 0,
      dur,
      done,
    };
    start();
  }

  function updateEase(dt: number) {
    if (!ease) return;
    ease.t = Math.min(1, ease.t + dt / ease.dur);
    const e = easeInOut(ease.t);
    camera.position.lerpVectors(ease.startP, ease.endP, e);
    camera.quaternion.slerpQuaternions(ease.startQ, ease.endQ, e);
    if (ease.t >= 1) {
      const cb = ease.done;
      ease = null;
      cb();
    }
  }

  // --- State machine ----------------------------------------------------------
  let state: State = 'intro';
  let os: OSHandle | null = null;
  let panel: PanelHandle | null = null;
  let intentionalUnlock = false;

  const clearActiveHotspot = () => {
    if (activeHotspot) {
      activeHotspot.setHighlight(false);
      activeHotspot = null;
    }
    hudEl.classList.remove('can-use');
  };

  function showEnter() {
    enterEl.hidden = false;
    hudEl.hidden = true;
  }
  function hideEnter() {
    enterEl.hidden = true;
  }

  function enterComputer() {
    if (state === 'toComputer' || state === 'computer' || state === 'panel') return;
    state = 'toComputer';
    controls.enabled = false;
    clearActiveHotspot();
    hideEnter();
    hudEl.hidden = true;
    room.setScreenGlow(true);
    if (controls.isLocked) {
      intentionalUnlock = true;
      controls.unlock();
    }
    animateTo(room.sit.position, room.sit.target, 900, () => {
      state = 'computer';
      renderer.render(scene, camera);
      osEl.hidden = false;
      projectOverlay();
      if (!os) {
        os = createOS({ os: osEl, screen: osScreen, manifest, getBody, onStepBack: stepBack });
      }
    });
  }

  function stepBack() {
    if (state !== 'computer') return;
    state = 'toStand';
    osEl.hidden = true;
    if (os) {
      os.destroy();
      os = null;
    }
    room.setScreenGlow(false);
    animateTo(room.stand.position, room.stand.target, 800, () => {
      state = 'intro';
      showEnter();
      controls.enabled = true;
    });
  }

  // --- Focused in-world reader panels (non-computer hotspots) -----------------
  function openPanel(source: PanelDocSource) {
    if (state === 'panel' || state === 'toComputer' || state === 'computer') return;
    state = 'panel';
    clearActiveHotspot();
    hudEl.hidden = true;
    // Free the pointer so the reader can be scrolled and dismissed.
    if (controls.isLocked) {
      intentionalUnlock = true;
      controls.unlock();
    }
    if (!panel) panel = createReaderPanel({ layer: panelEl, getBody, onClose: onPanelClosed });
    panel.open(source);
  }

  function closePanel() {
    if (state !== 'panel' || !panel) return;
    panel.close(); // fires onPanelClosed
  }

  // Called when the panel tears itself down (close button, backdrop, or Esc).
  function onPanelClosed() {
    state = 'intro';
    showEnter();
    // If this close came from a user gesture, re-lock straight back into
    // walking; the 'lock' handler then hides the enter card. If the browser
    // refuses, the enter card stays as the fallback way back in.
    if (canWalk) {
      // requestPointerLock() rejects asynchronously (an Esc-driven close carries
      // no transient user activation, and there's a ~1.25s re-lock cooldown), so a
      // try/catch around controls.lock() can never catch it — the rejection would
      // surface as a console error. Call it directly and swallow the rejection;
      // the enter card is already shown as the fallback way back into walking.
      const el = controls.domElement as
        | (HTMLElement & { requestPointerLock(opts?: unknown): unknown })
        | null;
      const req = el?.requestPointerLock?.({ unadjustedMovement: false });
      if (req && typeof (req as { catch?: unknown }).catch === 'function') {
        (req as Promise<unknown>).catch(() => {
          /* refused: stay on the enter card */
        });
      }
    }
  }

  function activateHotspot(hs: Hotspot) {
    if (hs.action.type === 'computer') enterComputer();
    else openPanel(hs.action.source);
  }

  function readPlainly() {
    if (controls.isLocked) {
      intentionalUnlock = true;
      controls.unlock();
    }
    stop();
    worldEl.hidden = true;
    root.classList.remove('is-world');
    if (plain) {
      plain.removeAttribute('aria-hidden');
      plain.removeAttribute('inert');
    }
    reenterBtn.hidden = false;
  }

  function reenterWorld() {
    reenterBtn.hidden = true;
    worldEl.hidden = false;
    root.classList.add('is-world');
    if (plain) {
      plain.setAttribute('aria-hidden', 'true');
      plain.setAttribute('inert', '');
    }
    state = 'intro';
    showEnter();
    resize();
    start();
  }

  // --- Controls events --------------------------------------------------------
  controls.addEventListener('lock', () => {
    state = 'walking';
    hideEnter();
    hudEl.hidden = false;
  });
  controls.addEventListener('unlock', () => {
    keys.clear(); // pointer lock lost (Esc / alt-tab / OS overlay): drop held keys so the camera can't drift
    if (intentionalUnlock) {
      intentionalUnlock = false;
      return;
    }
    // User pressed Esc while walking.
    if (state === 'walking') {
      state = 'intro';
      showEnter();
      hudEl.hidden = true;
    }
  });

  // --- Input listeners --------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent) => {
    keys.add(e.code);
    if (e.code === 'KeyE' && state === 'walking' && activeHotspot) {
      e.preventDefault();
      activateHotspot(activeHotspot);
    }
    if (e.code === 'Escape' && state === 'computer' && !(os && os.isFullscreen())) {
      stepBack();
    }
    if (e.code === 'Escape' && state === 'panel') {
      e.preventDefault();
      closePanel();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear()); // a window blur can swallow the keyup

  canvas.addEventListener('click', () => {
    if (state === 'walking' && activeHotspot) {
      activateHotspot(activeHotspot);
    } else if (state === 'intro' && canWalk) {
      controls.lock();
    }
  });

  // Enter-overlay buttons.
  enterEl.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest('[data-action]')?.getAttribute('data-action');
    if (!action) return;
    if (action === 'walk') controls.lock();
    else if (action === 'sit') enterComputer();
    else if (action === 'plainly') readPlainly();
  });

  // Floating "return to the studio" button used from plain mode.
  const reenterBtn = document.createElement('button');
  reenterBtn.type = 'button';
  reenterBtn.className = 'st-reenter';
  reenterBtn.textContent = 'Enter the studio ⤢';
  reenterBtn.hidden = true;
  reenterBtn.addEventListener('click', reenterWorld);
  root.appendChild(reenterBtn);

  window.addEventListener('resize', resize);

  // --- Render loop ------------------------------------------------------------
  let raf = 0;
  let running = false;
  let last = performance.now();

  function tick(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = now * 0.001;
    if (ease) {
      updateEase(dt);
      pulseHotspots(t);
      renderer.render(scene, camera);
    } else if (state === 'walking') {
      updateWalk(dt);
      checkHotspot();
      pulseHotspots(t);
      renderer.render(scene, camera);
    } else if (state === 'intro') {
      pulseHotspots(t);
      renderer.render(scene, camera);
    }
    // In 'computer' / 'panel' idle we skip rendering: the scene is static and the
    // reader is an HTML layer over the last frame, so nothing needs redrawing.
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      keys.clear();
      stop();
    } else if (!worldEl.hidden) start();
  });

  resize();
  showEnter();
  renderer.render(scene, camera); // paint at least one frame even if rAF is throttled
  start();

  // Image textures (framed art, the ceramics photo) load asynchronously. On a
  // throttled/backgrounded tab rAF is paused, so re-paint a few times as they
  // arrive to guarantee the first visible frame is fully textured.
  for (const ms of [150, 450, 1000, 1800]) {
    window.setTimeout(() => {
      if (state !== 'computer' && state !== 'panel') renderer.render(scene, camera);
    }, ms);
  }

  // --- Teardown (not normally called; kept for completeness / HMR safety) -----
  return function destroyStudio() {
    stop();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('resize', resize);
    if (os) os.destroy();
    if (panel) panel.destroy();
    room.dispose();
    renderer.dispose();
  };
}
