/**
 * room — the maker's studio, built entirely from three.js primitives, the shared
 * lathe-pot generator, and Ben's own local images used as textures on framed
 * planes and screens. No external models, textures, or HDRs are ever downloaded:
 * the sky, the wall calendar, and the poster are drawn procedurally into a
 * <canvas>, and the framed art / photos reuse the same JPEGs the site already
 * ships in /public/images.
 *
 * The room is meant to read as a warm, lived-in room, so it is dense with
 * character: a sunlit window, wood floor, shelves of ceramics interspersed with
 * instanced books, framed graphic-novel pages, a corkboard of pinned notes, a
 * wall calendar, desk clutter (mug, notebook, pens, headphones, a succulent), a
 * rug, a floor lamp, a plant, and a guitar in the corner.
 *
 * Beyond the shell it returns the interactive HOTSPOTS — the monitor, the framed
 * pages, a pot, books, the corkboard, a polaroid, the wall calendar — each with
 * the meshes to raycast against, a floating label, a highlight/idle-pulse hook,
 * and the action the world runs when the player uses it. Plus the collision
 * boxes, the monitor's live screen rectangle, the seated / standing camera
 * poses, and a dispose() that frees every geometry, material, and texture.
 */
import * as THREE from 'three';
import { buildPotGeometry, POT_PRESETS, CLAY_COLORS } from './pots';
import type { PanelDocSource } from './os';

export type HotspotAction = { type: 'computer' } | { type: 'panel'; source: PanelDocSource };

export interface Hotspot {
  id: string;
  /** Floating label / use-hint shown when the player looks at this object. */
  label: string;
  /** Max distance (m) the player may be from the hit point to use it. */
  reach: number;
  /** Meshes raycast against to detect look-at. */
  targets: THREE.Object3D[];
  action: HotspotAction;
  /** Steady bright highlight while targeted. */
  setHighlight: (on: boolean) => void;
  /** Subtle idle breathe so the object reads as interactive (time in seconds). */
  pulse: (time: number) => void;
}

export interface RoomHandles {
  /** World-space AABBs the player must not walk into. */
  colliders: THREE.Box3[];
  /** Interior wall bounds for the player {minX,maxX,minZ,maxZ}. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Everything the player can look at and use. */
  hotspots: Hotspot[];
  /** Fresh world-space screen corners: [topLeft, topRight, bottomRight, bottomLeft]. */
  getScreenCorners: () => THREE.Vector3[];
  /** Screen centre, for aiming the reticle test. */
  screenCenter: THREE.Vector3;
  /** Camera pose seated at the desk. */
  sit: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Camera pose standing back from the desk. */
  stand: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Set the monitor screen's emissive glow (on = seated / booted). */
  setScreenGlow: (on: boolean) => void;
  dispose: () => void;
}

export function buildRoom(scene: THREE.Scene): RoomHandles {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  const ROOM = { x: 4, z: 4, y: 3 };

  const mat = (opts: THREE.MeshStandardMaterialParameters) =>
    track(new THREE.MeshStandardMaterial(opts));

  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // --- Procedural canvas textures (no downloads) -----------------------------
  const makeCanvasTexture = (
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): THREE.CanvasTexture => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return track(t);
  };

  // Soft golden-hour sky seen through the window.
  const skyTex = makeCanvasTexture(256, 256, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#a9d3ea');
    g.addColorStop(0.42, '#e9ddc2');
    g.addColorStop(0.72, '#ffdfa6');
    g.addColorStop(1, '#ffcf88');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // A soft sun bloom high on the left, where the directional light comes from.
    const sun = ctx.createRadialGradient(70, 78, 4, 70, 78, 90);
    sun.addColorStop(0, 'rgba(255,250,235,0.95)');
    sun.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, 256, 256);
    // Suggested distant rooftops / warmth along the horizon.
    ctx.fillStyle = 'rgba(150,120,92,0.28)';
    for (let i = 0; i < 9; i++) {
      const bw = 18 + Math.random() * 26;
      const bh = 14 + Math.random() * 26;
      ctx.fillRect(i * 30 - 6, 224 - bh, bw, bh + 32);
    }
  });

  // A faint plaster grain so walls never read as one dead flat colour.
  const grainTex = makeCanvasTexture(128, 128, (ctx) => {
    const img = ctx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 176 + Math.random() * 74;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;

  // The wall "activity calendar", drawn as a grid of little coloured cells.
  const calTex = makeCanvasTexture(360, 248, (ctx) => {
    ctx.fillStyle = '#f6f1e6';
    ctx.fillRect(0, 0, 360, 248);
    ctx.fillStyle = '#171714';
    ctx.font = '700 22px Georgia, serif';
    ctx.fillText('Public progress', 22, 40);
    ctx.fillStyle = '#696861';
    ctx.font = 'italic 13px Georgia, serif';
    ctx.fillText('a record, not a score', 22, 60);
    const cols = ['#39795a', '#0b87b7', '#d26753', '#b47910', '#76558f'];
    const x0 = 22;
    const y0 = 84;
    const cell = 15;
    const gap = 3;
    for (let r = 0; r < 8; r++) {
      for (let cN = 0; cN < 20; cN++) {
        const on = Math.random();
        ctx.fillStyle =
          on < 0.32 ? '#e4dcca' : cols[(r + cN) % cols.length];
        ctx.globalAlpha = on < 0.32 ? 1 : 0.35 + Math.random() * 0.6;
        ctx.fillRect(x0 + cN * (cell + gap), y0 + r * (cell + gap), cell, cell);
      }
    }
    ctx.globalAlpha = 1;
  });

  // A typographic poster for the wall behind the spawn.
  const posterTex = makeCanvasTexture(480, 640, (ctx) => {
    ctx.fillStyle = '#f3efe6';
    ctx.fillRect(0, 0, 480, 640);
    ctx.strokeStyle = '#d26753';
    ctx.lineWidth = 10;
    ctx.strokeRect(24, 24, 432, 592);
    // A little coral thought-bubble mark.
    ctx.fillStyle = '#d26753';
    ctx.beginPath();
    ctx.ellipse(240, 210, 96, 74, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(180, 300, 20, 0, Math.PI * 2);
    ctx.arc(150, 336, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#171714';
    ctx.textAlign = 'center';
    ctx.font = '700 62px Georgia, serif';
    ctx.fillText('picturesuo', 240, 452);
    ctx.fillStyle = '#696861';
    ctx.font = 'italic 24px Georgia, serif';
    ctx.fillText('things made,', 240, 502);
    ctx.fillText('learned & noticed', 240, 534);
    ctx.textAlign = 'left';
  });

  // --- Local image textures (Ben's own /public assets) -----------------------
  const loader = new THREE.TextureLoader();
  const loadImageTex = (url: string): THREE.Texture => {
    const t = loader.load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return track(t);
  };
  const clayFight1 = loadImageTex('/images/legacy/graphic-novel-clay-fight/page-1.jpg');
  const clayFight3 = loadImageTex('/images/legacy/graphic-novel-clay-fight/page-3.jpg');
  const faceCupsTex = loadImageTex('/images/art/face-cups.jpeg');

  // --- Shell: floor, walls, ceiling ------------------------------------------
  const woodFloor = mat({
    color: '#b98a5a',
    roughness: 0.68,
    metalness: 0.04,
    bumpMap: grainTex,
    bumpScale: 0.02,
  });
  woodFloor.bumpMap!.repeat.set(6, 6);
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2)), woodFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Subtle plank lines drawn as thin darker strips, cheap and grounding.
  const plankMat = mat({ color: '#a2764a', roughness: 0.82 });
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM.x * 2, 0.02)), plankMat);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.002, i * 1.1);
    plank.receiveShadow = true;
    scene.add(plank);
  }

  // Warm plaster, with per-wall tints so the shell reads as light, not a grey box.
  const grain = () => {
    const t = grainTex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 2);
    return track(t);
  };
  const plasterBack = mat({ color: '#f1e8d5', roughness: 0.97, bumpMap: grain(), bumpScale: 0.004 });
  const plasterSide = mat({ color: '#ece2cd', roughness: 0.97, bumpMap: grain(), bumpScale: 0.004 });
  const plasterFront = mat({ color: '#f3ecdb', roughness: 0.97, bumpMap: grain(), bumpScale: 0.004 });
  const wall = (
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    ry: number,
    material: THREE.Material,
  ) => {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), material);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  wall(ROOM.x * 2, ROOM.y, 0, ROOM.y / 2, -ROOM.z, 0, plasterBack); // back
  wall(ROOM.z * 2, ROOM.y, -ROOM.x, ROOM.y / 2, 0, Math.PI / 2, plasterSide); // left
  wall(ROOM.z * 2, ROOM.y, ROOM.x, ROOM.y / 2, 0, -Math.PI / 2, plasterSide); // right
  wall(ROOM.x * 2, ROOM.y, 0, ROOM.y / 2, ROOM.z, Math.PI, plasterFront); // front (behind spawn)

  const ceilingMat = mat({ color: '#f6f1e6', roughness: 1 });
  const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2)), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.y;
  scene.add(ceiling);

  // Simple baseboard trim around the room for a finished, built look.
  const trimMat = mat({ color: '#e3d8c1', roughness: 0.85 });
  scene.add(box(ROOM.x * 2, 0.12, 0.03, trimMat, 0, 0.06, -3.98)); // back
  scene.add(box(0.03, 0.12, ROOM.z * 2, trimMat, -3.98, 0.06, 0)); // left
  scene.add(box(0.03, 0.12, ROOM.z * 2, trimMat, 3.98, 0.06, 0)); // right
  scene.add(box(ROOM.x * 2, 0.12, 0.03, trimMat, 0, 0.06, 3.98)); // front

  // --- Window with warm sky behind it (on the back wall, above the desk) ------
  const skyMat = mat({
    color: '#ffffff',
    map: skyTex,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: skyTex,
    emissiveIntensity: 0.85,
    roughness: 1,
  });
  const sky = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, 1.6)), skyMat);
  sky.position.set(-0.2, 2.0, -3.97);
  scene.add(sky);

  const frameMat = mat({ color: '#efe7d6', roughness: 0.7 });
  const frameBar = (w: number, h: number, x: number, y: number) =>
    scene.add(box(w, h, 0.06, frameMat, x, y, -3.95));
  frameBar(2.7, 0.09, -0.2, 2.82); // top
  frameBar(2.7, 0.09, -0.2, 1.2); // bottom
  frameBar(0.09, 1.7, -1.5, 2.0); // left
  frameBar(0.09, 1.7, 1.1, 2.0); // right
  frameBar(0.05, 1.7, -0.2, 2.0); // mullion vertical
  frameBar(2.7, 0.05, -0.2, 2.0); // mullion horizontal
  // A narrow sill.
  scene.add(box(2.8, 0.06, 0.14, frameMat, -0.2, 1.16, -3.88));

  // --- Framed-picture helper --------------------------------------------------
  // Builds, in local space (facing +z), a matted, framed image; the caller
  // rotates the group onto the correct wall. Returns the group, the image mesh
  // (raycast target + glow), and the image material (for highlight).
  const woodFrameMat = mat({ color: '#5a3f28', roughness: 0.5, metalness: 0.05 });
  const blackFrameMat = mat({ color: '#26241f', roughness: 0.45, metalness: 0.1 });
  const matBoardMat = mat({ color: '#f4efe4', roughness: 0.9 });
  const framedPicture = (opts: {
    tex: THREE.Texture;
    w: number;
    h: number;
    frame?: THREE.Material;
    x: number;
    y: number;
    z: number;
    ry: number;
  }) => {
    const { tex, w, h, frame = woodFrameMat, x, y, z, ry } = opts;
    const group = new THREE.Group();
    const border = 0.09;
    const matPad = 0.05;
    // Frame slab.
    group.add(box(w + border * 2, h + border * 2, 0.05, frame, 0, 0, 0));
    // Mat board.
    const board = new THREE.Mesh(track(new THREE.PlaneGeometry(w + matPad * 2, h + matPad * 2)), matBoardMat);
    board.position.set(0, 0, 0.027);
    group.add(board);
    // The image.
    const picMat = mat({
      color: '#ffffff',
      map: tex,
      emissive: new THREE.Color('#ffffff'),
      emissiveMap: tex,
      emissiveIntensity: 0,
      roughness: 0.62,
      metalness: 0,
    });
    const pic = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), picMat);
    pic.position.set(0, 0, 0.03);
    group.add(pic);
    group.position.set(x, y, z);
    group.rotation.y = ry;
    scene.add(group);
    return { group, pic, picMat };
  };

  // --- Desk -------------------------------------------------------------------
  const desk = new THREE.Group();
  const woodDark = mat({ color: '#7a5533', roughness: 0.5, metalness: 0.05 });
  const top = box(2.6, 0.06, 0.95, woodDark, 0, 0.76, -3.08);
  desk.add(top);
  const legXs = [-1.2, 1.2];
  const legZs = [-3.45, -2.75];
  for (const lx of legXs)
    for (const lz of legZs) desk.add(box(0.08, 0.76, 0.08, woodDark, lx, 0.38, lz));
  scene.add(desk);

  // --- Monitor ---------------------------------------------------------------
  const monitor = new THREE.Group();
  const metal = mat({ color: '#2b2b28', roughness: 0.5, metalness: 0.3 });
  monitor.add(box(0.34, 0.02, 0.20, metal, 0, 0.8, -3.35)); // stand foot
  monitor.add(box(0.06, 0.34, 0.06, metal, 0, 0.97, -3.4)); // stand neck
  const bezelMat = mat({
    color: '#17171a',
    emissive: new THREE.Color('#ffb060'),
    emissiveIntensity: 0,
    roughness: 0.4,
    metalness: 0.2,
  });
  const bezel = box(1.54, 0.94, 0.05, bezelMat, 0, 1.34, -3.42);
  monitor.add(bezel);

  const screenMat = mat({
    color: '#0e0e10',
    emissive: new THREE.Color('#f3f0e8'),
    emissiveIntensity: 0.0,
    roughness: 0.32,
    metalness: 0.0,
  });
  const SCREEN_W = 1.44;
  const SCREEN_H = 0.84;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H)), screenMat);
  screen.position.set(0, 1.34, -3.394);
  monitor.add(screen);
  scene.add(monitor);

  // Keyboard + mouse
  monitor.add(box(0.52, 0.025, 0.17, metal, 0, 0.795, -2.98));
  monitor.add(box(0.07, 0.03, 0.11, metal, 0.42, 0.795, -2.95));

  const getScreenCorners = (): THREE.Vector3[] => {
    screen.updateWorldMatrix(true, false);
    const hw = SCREEN_W / 2;
    const hh = SCREEN_H / 2;
    return [
      new THREE.Vector3(-hw, hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(-hw, -hh, 0),
    ].map((v) => v.applyMatrix4(screen.matrixWorld));
  };
  const screenCenter = new THREE.Vector3(0, 1.2, -3.394);

  const setScreenGlow = (on: boolean) => {
    screenMat.emissiveIntensity = on ? 0.6 : 0.26;
  };
  setScreenGlow(false);

  // --- Desk lamp (with its own warm point light) -----------------------------
  const lampMat = mat({ color: '#c96a4c', roughness: 0.6, metalness: 0.1 });
  const lamp = new THREE.Group();
  const lampBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.11, 0.13, 0.03, 20)), lampMat);
  lampBase.position.set(0.95, 0.795, -3.32);
  lampBase.castShadow = true;
  lamp.add(lampBase);
  lamp.add(box(0.03, 0.42, 0.03, lampMat, 0.95, 1.0, -3.32));
  const arm = box(0.36, 0.03, 0.03, lampMat, 0.82, 1.2, -3.28);
  arm.rotation.z = -0.5;
  lamp.add(arm);
  const shade = new THREE.Mesh(track(new THREE.ConeGeometry(0.12, 0.16, 20, 1, true)), lampMat);
  shade.position.set(0.66, 1.12, -3.24);
  shade.rotation.z = Math.PI * 0.62;
  shade.castShadow = true;
  lamp.add(shade);
  scene.add(lamp);

  const lampLight = new THREE.PointLight(0xffd39a, 5, 3.4, 2);
  lampLight.position.set(0.62, 1.08, -3.1);
  lampLight.castShadow = false;
  scene.add(lampLight);
  const bulb = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.04, 12, 12)),
    mat({ color: '#fff1cf', emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 1.4, roughness: 1 }),
  );
  bulb.position.copy(lampLight.position);
  scene.add(bulb);

  // --- Desk clutter (life) ----------------------------------------------------
  const DESK_Y = 0.79; // top surface
  // Mug + handle.
  const mugMat = mat({ color: '#3f5a6b', roughness: 0.6 });
  const mug = new THREE.Mesh(track(new THREE.CylinderGeometry(0.05, 0.045, 0.1, 18)), mugMat);
  mug.position.set(0.5, DESK_Y + 0.05, -2.96);
  mug.castShadow = true;
  scene.add(mug);
  const mugHandle = new THREE.Mesh(track(new THREE.TorusGeometry(0.035, 0.01, 8, 16)), mugMat);
  mugHandle.position.set(0.56, DESK_Y + 0.05, -2.96);
  mugHandle.rotation.y = Math.PI / 2;
  scene.add(mugHandle);

  // Notebook stack, slightly askew.
  const paperMat = mat({ color: '#f2ecdd', roughness: 0.9 });
  const paperStack = box(0.28, 0.03, 0.36, paperMat, -0.75, DESK_Y + 0.015, -3.02);
  paperStack.rotation.y = 0.18;
  scene.add(paperStack);
  const notebook = box(0.24, 0.02, 0.31, mat({ color: '#8a6a3a', roughness: 0.7 }), -0.7, DESK_Y + 0.04, -3.0);
  notebook.rotation.y = -0.12;
  scene.add(notebook);

  // Pen cup with pens.
  const cupMat = mat({ color: '#8f6f52', roughness: 0.8 });
  const penCup = new THREE.Mesh(track(new THREE.CylinderGeometry(0.04, 0.035, 0.11, 14)), cupMat);
  penCup.position.set(-1.0, DESK_Y + 0.055, -3.28);
  penCup.castShadow = true;
  scene.add(penCup);
  const penColors = ['#171714', '#d26753', '#0b87b7', '#39795a'];
  for (let i = 0; i < 4; i++) {
    const pen = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6)),
      mat({ color: penColors[i], roughness: 0.6 }),
    );
    pen.position.set(-1.0 + (i - 1.5) * 0.012, DESK_Y + 0.11, -3.28);
    pen.rotation.set((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5);
    scene.add(pen);
  }

  // Headphones resting on the desk (band + two cups).
  const hpMat = mat({ color: '#2b2b28', roughness: 0.6, metalness: 0.2 });
  const band = new THREE.Mesh(track(new THREE.TorusGeometry(0.09, 0.012, 10, 20, Math.PI)), hpMat);
  band.position.set(-0.35, DESK_Y + 0.09, -3.18);
  band.rotation.set(Math.PI / 2, 0, 0);
  scene.add(band);
  for (const s of [-1, 1]) {
    const cup = new THREE.Mesh(track(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16)), hpMat);
    cup.position.set(-0.35 + s * 0.09, DESK_Y + 0.03, -3.18);
    cup.rotation.z = Math.PI / 2;
    scene.add(cup);
  }

  // A little succulent in a pot.
  const succPot = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 16)),
    mat({ color: '#b5623f', roughness: 0.9 }),
  );
  succPot.position.set(0.78, DESK_Y + 0.035, -3.26);
  succPot.castShadow = true;
  scene.add(succPot);
  const succMat = mat({ color: '#5f7d4c', roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(track(new THREE.ConeGeometry(0.02, 0.09, 5)), succMat);
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(0.78 + Math.cos(a) * 0.02, DESK_Y + 0.1, -3.26 + Math.sin(a) * 0.02);
    leaf.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
    scene.add(leaf);
  }

  // --- Chair ------------------------------------------------------------------
  const chair = new THREE.Group();
  const chairMat = mat({ color: '#3f4a44', roughness: 0.8 });
  chair.add(box(0.5, 0.07, 0.5, chairMat, 0, 0.5, -2.45));
  chair.add(box(0.5, 0.55, 0.06, chairMat, 0, 0.8, -2.68));
  const stem = new THREE.Mesh(track(new THREE.CylinderGeometry(0.04, 0.04, 0.45, 12)), metal);
  stem.position.set(0, 0.27, -2.45);
  stem.castShadow = true;
  chair.add(stem);
  const chairBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 5)), metal);
  chairBase.position.set(0, 0.04, -2.45);
  chair.add(chairBase);
  scene.add(chair);

  // --- Shelves of ceramics + books (left wall) --------------------------------
  const shelfMat = mat({ color: '#8a6540', roughness: 0.6 });
  const potGeos = Object.values(POT_PRESETS).map((p) =>
    track(buildPotGeometry(THREE, { control: p.control, lobes: p.lobes, amp: p.amp, segments: 96 })),
  );

  const placePot = (
    x: number,
    y: number,
    z: number,
    presetIdx: number,
    scale: number,
    colorIdx: number,
  ): THREE.Mesh => {
    const geo = potGeos[presetIdx % potGeos.length];
    const clayMat = mat({
      color: CLAY_COLORS[colorIdx % CLAY_COLORS.length],
      emissive: new THREE.Color('#ff9a5a'),
      emissiveIntensity: 0,
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const pot = new THREE.Mesh(geo, clayMat);
    geo.computeBoundingBox();
    const halfH = ((geo.boundingBox!.max.y - geo.boundingBox!.min.y) / 2) * scale;
    pot.scale.setScalar(scale);
    pot.position.set(x, y + halfH, z);
    pot.rotation.y = Math.random() * Math.PI;
    pot.castShadow = true;
    scene.add(pot);
    return pot;
  };

  const shelfLevels = [1.05, 1.68, 2.28];
  shelfLevels.forEach((y, i) => {
    scene.add(box(0.34, 0.04, 1.9, shelfMat, -3.82, y, -0.3));
    scene.add(box(0.28, 0.03, 0.03, shelfMat, -3.8, y - 0.05, -1.0 + i * 0.1));
    scene.add(box(0.28, 0.03, 0.03, shelfMat, -3.8, y - 0.05, 0.4 - i * 0.1));
  });

  // Pots scattered across the shelves (fewer than before to leave room for books).
  placePot(-3.8, shelfLevels[0] + 0.02, -0.9, 0, 0.22, 0);
  placePot(-3.78, shelfLevels[0] + 0.02, -0.2, 2, 0.2, 1);
  placePot(-3.8, shelfLevels[1] + 0.02, -0.85, 1, 0.19, 3);
  placePot(-3.79, shelfLevels[1] + 0.02, -0.2, 4, 0.2, 2);
  placePot(-3.8, shelfLevels[2] + 0.02, -0.75, 3, 0.17, 5);

  // Instanced filler books — one draw call, per-instance warm colours + tilts.
  const bookColors = ['#7a4b3a', '#3f5a6b', '#8a6a3a', '#5a4636', '#93553f', '#6d7a5a', '#404a55', '#a9805a'];
  const bookRows: Array<{ y: number; z0: number; z1: number }> = [
    { y: shelfLevels[2] + 0.02, z0: -1.0, z1: 0.55 }, // top shelf: a long row
    { y: shelfLevels[1] + 0.02, z0: 0.05, z1: 0.55 }, // middle: a short run beside the pots
    { y: shelfLevels[0] + 0.02, z0: 0.05, z1: 0.55 }, // bottom: a short run
  ];
  const bookTransforms: Array<{ p: THREE.Vector3; s: THREE.Vector3; tilt: number; color: THREE.Color }> = [];
  for (const row of bookRows) {
    let z = row.z0;
    while (z < row.z1) {
      const thick = 0.03 + Math.random() * 0.025;
      const height = 0.18 + Math.random() * 0.09;
      const depth = 0.15 + Math.random() * 0.03;
      const tilt = Math.random() < 0.16 ? (Math.random() - 0.5) * 0.5 : 0;
      bookTransforms.push({
        p: new THREE.Vector3(-3.79, row.y + height / 2, z + thick / 2),
        s: new THREE.Vector3(depth, height, thick),
        tilt,
        color: new THREE.Color(bookColors[Math.floor(Math.random() * bookColors.length)]),
      });
      z += thick + 0.006;
    }
  }
  const bookGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const bookMat = mat({ color: '#ffffff', roughness: 0.75, metalness: 0 });
  const books = new THREE.InstancedMesh(bookGeo, bookMat, bookTransforms.length);
  books.castShadow = true;
  books.receiveShadow = true;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  bookTransforms.forEach((b, i) => {
    q.setFromEuler(new THREE.Euler(b.tilt, 0, 0));
    m4.compose(b.p, q, b.s);
    books.setMatrixAt(i, m4);
    books.setColorAt(i, b.color);
  });
  books.instanceMatrix.needsUpdate = true;
  if (books.instanceColor) books.instanceColor.needsUpdate = true;
  scene.add(books);
  track(books);

  // Two hero books on the middle shelf: the interactive "essays".
  const heroBookMat = (color: string) =>
    mat({ color, emissive: new THREE.Color('#ffbf7a'), emissiveIntensity: 0, roughness: 0.6 });
  const heroBookA_mat = heroBookMat('#3f6f8a');
  const heroBookA = box(0.16, 0.24, 0.045, heroBookA_mat, -3.79, shelfLevels[1] + 0.02 + 0.12, -0.05);
  heroBookA.rotation.x = 0.08;
  scene.add(heroBookA);
  const heroBookB_mat = heroBookMat('#b0533c');
  const heroBookB = box(0.16, 0.22, 0.045, heroBookB_mat, -3.79, shelfLevels[1] + 0.02 + 0.11, 0.0);
  heroBookB.rotation.x = -0.14; // leaning against A
  scene.add(heroBookB);

  // --- Framed graphic-novel pages (back wall, right of the window) -----------
  const cf1 = framedPicture({ tex: clayFight1, w: 0.62, h: 0.82, x: 1.95, y: 1.85, z: -3.92, ry: 0, frame: blackFrameMat });
  const cf2 = framedPicture({ tex: clayFight3, w: 0.52, h: 0.68, x: 2.92, y: 1.72, z: -3.92, ry: 0, frame: blackFrameMat });

  // --- Framed ceramics photo (back wall, left of the window) -----------------
  const facePic = framedPicture({ tex: faceCupsTex, w: 0.6, h: 0.8, x: -2.7, y: 1.75, z: -3.92, ry: 0 });

  // --- Wall calendar (right wall) --------------------------------------------
  const calPic = framedPicture({
    tex: calTex,
    w: 1.0,
    h: 0.69,
    x: 3.9,
    y: 1.75,
    z: 0.5,
    ry: -Math.PI / 2,
    frame: woodFrameMat,
  });

  // --- Poster (front wall, behind spawn — warms up the "grey" side) ----------
  framedPicture({ tex: posterTex, w: 0.95, h: 1.27, x: -1.7, y: 1.75, z: 3.92, ry: Math.PI, frame: woodFrameMat });

  // --- Corkboard with pinned notes + a polaroid (right wall) -----------------
  const corkGroup = new THREE.Group();
  const corkMat = mat({ color: '#c69a5f', roughness: 0.95 });
  const corkBoard = box(1.15, 0.85, 0.03, corkMat, 0, 0, 0);
  corkGroup.add(corkBoard);
  corkGroup.add(box(1.23, 0.93, 0.02, mat({ color: '#6d4a2c', roughness: 0.6 }), 0, 0, -0.01)); // frame behind
  const noteColors = ['#f2d06b', '#e79bb0', '#a9d5ea', '#f3efe4'];
  const notes: THREE.Mesh[] = [];
  const notePlacements = [
    [-0.34, 0.18, 0.2],
    [0.02, 0.24, -0.15],
    [0.34, 0.1, 0.1],
    [-0.28, -0.2, -0.1],
    [0.28, -0.22, 0.24],
  ];
  notePlacements.forEach((n, i) => {
    const note = box(0.2, 0.2, 0.006, mat({ color: noteColors[i % noteColors.length], roughness: 0.9 }), n[0], n[1], 0.02);
    note.rotation.z = n[2];
    corkGroup.add(note);
    notes.push(note);
  });
  // A polaroid = the "About" hotspot.
  const polaroidMat = mat({
    color: '#fbf7ee',
    emissive: new THREE.Color('#ffd08a'),
    emissiveIntensity: 0,
    roughness: 0.85,
  });
  const polaroid = box(0.24, 0.28, 0.008, polaroidMat, 0.02, -0.02, 0.03);
  polaroid.rotation.z = -0.07;
  corkGroup.add(polaroid);
  // A small ceramic-toned "photo" inside the polaroid.
  corkGroup.add(box(0.19, 0.19, 0.004, mat({ color: '#a5553f', roughness: 0.8 }), 0.02, 0.02, 0.036));
  corkGroup.position.set(3.9, 1.6, -1.5);
  corkGroup.rotation.y = -Math.PI / 2;
  scene.add(corkGroup);

  // --- Rug --------------------------------------------------------------------
  const rugMat = mat({ color: '#c96a4c', roughness: 1, metalness: 0 });
  const rug = new THREE.Mesh(track(new THREE.CircleGeometry(1.7, 40)), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.2, 0.004, -1.2);
  rug.receiveShadow = true;
  scene.add(rug);
  const rugInner = new THREE.Mesh(
    track(new THREE.RingGeometry(1.4, 1.5, 40)),
    mat({ color: '#e7d8c5', roughness: 1 }),
  );
  rugInner.rotation.x = -Math.PI / 2;
  rugInner.position.set(0.2, 0.006, -1.2);
  scene.add(rugInner);

  // --- Floor lamp (front-left corner: warms the wall behind the spawn) -------
  const floorLamp = new THREE.Group();
  const flMetal = mat({ color: '#3a3a34', roughness: 0.4, metalness: 0.5 });
  const flBase = new THREE.Mesh(track(new THREE.CylinderGeometry(0.16, 0.19, 0.04, 20)), flMetal);
  flBase.position.set(-3.2, 0.02, 2.9);
  flBase.castShadow = true;
  floorLamp.add(flBase);
  floorLamp.add(box(0.035, 1.55, 0.035, flMetal, -3.2, 0.79, 2.9));
  const flShade = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.19, 0.24, 0.28, 22, 1, true)),
    mat({ color: '#e8c98f', emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.6, roughness: 0.9, side: THREE.DoubleSide }),
  );
  flShade.position.set(-3.2, 1.62, 2.9);
  floorLamp.add(flShade);
  scene.add(floorLamp);
  const floorLampLight = new THREE.PointLight(0xffcf95, 6, 5.5, 2);
  floorLampLight.position.set(-3.2, 1.55, 2.9);
  scene.add(floorLampLight);

  // --- Plant in a corner ------------------------------------------------------
  const plant = new THREE.Group();
  const plantPot = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.2, 0.16, 0.4, 20)),
    mat({ color: '#b5623f', roughness: 0.9 }),
  );
  plantPot.position.set(3.3, 0.2, -3.1);
  plantPot.castShadow = true;
  plant.add(plantPot);
  const leafMat = mat({ color: '#4f6f43', roughness: 0.85 });
  const leafMat2 = mat({ color: '#5f7d4c', roughness: 0.85 });
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(
      track(new THREE.ConeGeometry(0.08, 0.7 + Math.random() * 0.4, 6)),
      i % 2 ? leafMat : leafMat2,
    );
    leaf.position.set(3.3 + (Math.random() - 0.5) * 0.24, 0.7 + Math.random() * 0.2, -3.1 + (Math.random() - 0.5) * 0.24);
    leaf.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.6);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  scene.add(plant);

  // --- Guitar leaning in the front-right corner -------------------------------
  const guitar = new THREE.Group();
  const guitarBodyMat = mat({ color: '#9a5a2c', roughness: 0.4, metalness: 0.05 });
  const gBody = new THREE.Mesh(track(new THREE.CylinderGeometry(0.19, 0.19, 0.07, 24)), guitarBodyMat);
  gBody.scale.set(1, 1, 0.62);
  gBody.rotation.x = Math.PI / 2;
  gBody.position.set(0, 0.42, 0);
  guitar.add(gBody);
  const gWaist = new THREE.Mesh(track(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 24)), guitarBodyMat);
  gWaist.scale.set(1, 1, 0.62);
  gWaist.rotation.x = Math.PI / 2;
  gWaist.position.set(0, 0.62, 0);
  guitar.add(gWaist);
  guitar.add(box(0.04, 0.02, 0.04, mat({ color: '#171714', roughness: 0.6 }), 0, 0.42, 0.05)); // sound hole hint
  const neck = box(0.05, 0.72, 0.03, mat({ color: '#5a3f28', roughness: 0.5 }), 0, 1.0, 0);
  guitar.add(neck);
  guitar.add(box(0.07, 0.12, 0.035, mat({ color: '#2b2b28', roughness: 0.5 }), 0, 1.4, 0)); // headstock
  guitar.position.set(3.4, 0, 2.7);
  guitar.rotation.set(0.16, -0.5, 0.12); // leaning back into the corner
  guitar.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  scene.add(guitar);

  // --- Lighting ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x7a6248, 0.9);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xfff0dd, 0.34);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffe6c2, 2.6);
  sun.position.set(-2.4, 4.6, -7.5); // beyond the window, streaming in
  sun.target.position.set(0.8, 0.8, -1.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 20;
  sun.shadow.camera.left = -6;
  sun.shadow.camera.right = 6;
  sun.shadow.camera.top = 6;
  sun.shadow.camera.bottom = -6;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // Cool sky bounce from the room's open side so shadows aren't muddy.
  const fill = new THREE.DirectionalLight(0xdfeaf2, 0.3);
  fill.position.set(3.5, 2.5, 3.5);
  scene.add(fill);

  // A soft warm room-fill so no wall — especially behind the spawn — reads dead
  // grey. Cheap, shadowless, gently lifts the whole space to golden-hour warmth.
  const warmFill = new THREE.PointLight(0xffddab, 10, 11, 1.5);
  warmFill.position.set(0.2, 2.55, 0.6);
  scene.add(warmFill);

  scene.background = new THREE.Color('#f0e6d2');
  scene.fog = new THREE.Fog(0xf0e6d2, 11, 24);

  // --- Highlight / idle-pulse helper -----------------------------------------
  const makeGlow = (
    materials: THREE.MeshStandardMaterial[],
    baseI: number,
    hiI: number,
    amp: number,
  ) => {
    const phase = Math.random() * Math.PI * 2;
    let highlighted = false;
    return {
      setHighlight: (on: boolean) => {
        highlighted = on;
      },
      pulse: (time: number) => {
        const wave = 0.5 + 0.5 * Math.sin(time * 1.4 + phase);
        const i = highlighted ? hiI : baseI + amp * wave;
        for (const m of materials) m.emissiveIntensity = i;
      },
    };
  };

  // --- Hotspots ---------------------------------------------------------------
  const computerGlow = makeGlow([bezelMat], 0, 0.5, 0.06);
  const clayFightGlow = makeGlow([cf1.picMat, cf2.picMat], 0, 0.42, 0.045);
  const faceGlow = makeGlow([facePic.picMat], 0, 0.42, 0.045);

  const heroPot = placePot(-1.05, 0.79, -3.3, 0, 0.16, 0);
  const heroPotGlow = makeGlow([heroPot.material as THREE.MeshStandardMaterial], 0, 0.34, 0.06);
  const bookAGlow = makeGlow([heroBookA_mat], 0, 0.4, 0.06);
  const bookBGlow = makeGlow([heroBookB_mat], 0, 0.4, 0.06);
  const corkGlow = makeGlow(
    notes.map((n) => n.material as THREE.MeshStandardMaterial),
    0,
    0.3,
    0.05,
  );
  const polaroidGlow = makeGlow([polaroidMat], 0, 0.4, 0.05);
  const calGlow = makeGlow([calPic.picMat], 0, 0.42, 0.045);

  const hotspots: Hotspot[] = [
    {
      id: 'computer',
      label: 'Use the computer',
      reach: 3.0,
      targets: [bezel, screen],
      action: { type: 'computer' },
      setHighlight: computerGlow.setHighlight,
      pulse: computerGlow.pulse,
    },
    {
      id: 'clay-fight',
      label: 'Read “Clay Fight”',
      reach: 3.4,
      targets: [cf1.pic, cf2.pic],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: 'Graphic Novel: Clay Fight',
          meta: 'Writing · Essay · 2023',
          bodyId: 'writing-graphic-novel-clay-fight',
          accent: 'var(--green)',
        },
      },
      setHighlight: clayFightGlow.setHighlight,
      pulse: clayFightGlow.pulse,
    },
    {
      id: 'face-cups',
      label: 'See “Three Faces”',
      reach: 3.4,
      targets: [facePic.pic],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: 'Three Faces',
          meta: 'Art · Glazed ceramic · 2023',
          bodyId: 'art-face-cups',
          accent: 'var(--coral)',
          heroImage: { src: '/images/art/face-cups.jpeg', alt: 'Three stacked face cups' },
        },
      },
      setHighlight: faceGlow.setHighlight,
      pulse: faceGlow.pulse,
    },
    {
      id: 'hero-pot',
      label: 'See “Figure in Progress”',
      reach: 2.6,
      targets: [heroPot],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: 'Figure in Progress',
          meta: 'Art · Unfired clay · 2024',
          bodyId: 'art-clay-figure',
          accent: 'var(--coral)',
          heroImage: { src: '/images/art/clay-figure.jpeg', alt: 'A hand-built clay figure' },
        },
      },
      setHighlight: heroPotGlow.setHighlight,
      pulse: heroPotGlow.pulse,
    },
    {
      id: 'book-a',
      label: 'Read “Current Interests in Life”',
      reach: 2.5,
      targets: [heroBookA],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: '9/12 Current Interests in Life',
          meta: 'Writing · Essay',
          bodyId: 'writing-9-12-current-interests-in-life',
          accent: 'var(--green)',
        },
      },
      setHighlight: bookAGlow.setHighlight,
      pulse: bookAGlow.pulse,
    },
    {
      id: 'book-b',
      label: 'Read “Initial Intentions”',
      reach: 2.5,
      targets: [heroBookB],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: '(READ FIRST) Initial Intentions',
          meta: 'Writing · Essay',
          bodyId: 'writing-read-first-initial-intentions',
          accent: 'var(--green)',
        },
      },
      setHighlight: bookBGlow.setHighlight,
      pulse: bookBGlow.pulse,
    },
    {
      id: 'corkboard',
      label: 'What I’m doing now',
      reach: 3.2,
      targets: [corkBoard, ...notes],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: 'Now',
          meta: 'What has my attention this season',
          bodyId: 'doc-now',
          accent: 'var(--amber)',
        },
      },
      setHighlight: corkGlow.setHighlight,
      pulse: corkGlow.pulse,
    },
    {
      id: 'polaroid',
      label: 'About Ben',
      reach: 3.2,
      targets: [polaroid],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: 'About',
          meta: 'The through-line',
          bodyId: 'doc-about',
          accent: 'var(--plum)',
        },
      },
      setHighlight: polaroidGlow.setHighlight,
      pulse: polaroidGlow.pulse,
    },
    {
      id: 'calendar',
      label: 'See the progress log',
      reach: 3.4,
      targets: [calPic.pic],
      action: {
        type: 'panel',
        source: {
          kind: 'doc',
          title: 'Public Progress',
          meta: 'A record, not a score',
          bodyId: 'doc-progress',
          accent: 'var(--blue-dark)',
        },
      },
      setHighlight: calGlow.setHighlight,
      pulse: calGlow.pulse,
    },
  ];

  // --- Collision + bounds -----------------------------------------------------
  const colliders = [
    new THREE.Box3().setFromObject(desk),
    new THREE.Box3().setFromObject(chair),
    new THREE.Box3(new THREE.Vector3(3.05, 0, -3.35), new THREE.Vector3(3.55, 0.5, -2.85)), // plant pot
    new THREE.Box3(new THREE.Vector3(-3.42, 0, 2.66), new THREE.Vector3(-2.98, 1.7, 3.1)), // floor lamp
    new THREE.Box3(new THREE.Vector3(3.16, 0, 2.44), new THREE.Vector3(3.64, 1.5, 2.96)), // guitar
  ];
  const bounds = { minX: -ROOM.x + 0.35, maxX: ROOM.x - 0.35, minZ: -ROOM.z + 0.35, maxZ: ROOM.z - 0.35 };

  const sit = {
    position: new THREE.Vector3(0, 1.16, -2.42),
    target: new THREE.Vector3(0, 1.2, -3.4),
  };
  const stand = {
    position: new THREE.Vector3(0, 1.62, -1.75),
    target: new THREE.Vector3(0, 1.35, -3.4),
  };

  const dispose = () => {
    for (const d of disposables) {
      try {
        d.dispose();
      } catch {
        /* already gone */
      }
    }
  };

  return {
    colliders,
    bounds,
    hotspots,
    getScreenCorners,
    screenCenter,
    sit,
    stand,
    setScreenGlow,
    dispose,
  };
}
