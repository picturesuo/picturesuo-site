/**
 * room — the maker's studio, built entirely from three.js primitives and the
 * shared lathe-pot generator. No external models or textures: warm wood floor,
 * plaster walls, a sunlit window, a desk with a monitor / keyboard / lamp, a
 * chair, wall shelves of ceramics, a rug, and a plant.
 *
 * Returns the handful of things the world controller needs: collision boxes to
 * keep the player out of the furniture, the monitor's screen rectangle (so the
 * HTML desktop can be projected onto it), the seated + standing camera poses,
 * and a dispose() that frees every geometry, material, and texture.
 */
import * as THREE from 'three';
import { buildPotGeometry, POT_PRESETS, CLAY_COLORS } from './pots';

export interface RoomHandles {
  /** World-space AABBs the player must not walk into. */
  colliders: THREE.Box3[];
  /** Interior wall bounds for the player {minX,maxX,minZ,maxZ}. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** The bezel + screen meshes the player raycasts against to "use" the computer. */
  useTargets: THREE.Object3D[];
  /** Fresh world-space screen corners: [topLeft, topRight, bottomRight, bottomLeft]. */
  getScreenCorners: () => THREE.Vector3[];
  /** Screen centre, for aiming the reticle test. */
  screenCenter: THREE.Vector3;
  /** Camera pose seated at the desk. */
  sit: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Camera pose standing back from the desk. */
  stand: { position: THREE.Vector3; target: THREE.Vector3 };
  /** Set the monitor screen's emissive glow (0 = off, 1 = on). */
  setScreenGlow: (on: boolean) => void;
  dispose: () => void;
}

export function buildRoom(scene: THREE.Scene): RoomHandles {
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(x: T): T => {
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

  // --- Shell: floor, walls, ceiling ------------------------------------------
  const woodFloor = mat({ color: '#b98a5a', roughness: 0.72, metalness: 0.02 });
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2)), woodFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Subtle plank lines drawn as thin darker strips, cheap and grounding.
  const plankMat = mat({ color: '#a2764a', roughness: 0.8 });
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM.x * 2, 0.02)), plankMat);
    plank.rotation.x = -Math.PI / 2;
    plank.position.set(0, 0.002, i * 1.1);
    plank.receiveShadow = true;
    scene.add(plank);
  }

  const plaster = mat({ color: '#efe9dc', roughness: 0.96, metalness: 0 });
  const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) => {
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), plaster);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  wall(ROOM.x * 2, ROOM.y, 0, ROOM.y / 2, -ROOM.z, 0); // back
  wall(ROOM.z * 2, ROOM.y, -ROOM.x, ROOM.y / 2, 0, Math.PI / 2); // left
  wall(ROOM.z * 2, ROOM.y, ROOM.x, ROOM.y / 2, 0, -Math.PI / 2); // right
  wall(ROOM.x * 2, ROOM.y, 0, ROOM.y / 2, ROOM.z, Math.PI); // front (behind spawn)

  const ceilingMat = mat({ color: '#f4efe4', roughness: 1 });
  const ceiling = new THREE.Mesh(track(new THREE.PlaneGeometry(ROOM.x * 2, ROOM.z * 2)), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM.y;
  scene.add(ceiling);

  // --- Window with warm sky behind it (on the back wall, above the desk) ------
  const skyMat = mat({
    color: '#fff4e0',
    emissive: new THREE.Color('#ffe6bd'),
    emissiveIntensity: 0.9,
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

  // --- Desk -------------------------------------------------------------------
  const desk = new THREE.Group();
  const woodDark = mat({ color: '#7a5533', roughness: 0.55, metalness: 0.05 });
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
  monitor.add(box(0.26, 0.02, 0.16, metal, 0, 0.8, -3.35)); // stand foot
  monitor.add(box(0.05, 0.26, 0.05, metal, 0, 0.93, -3.4)); // stand neck
  const bezelMat = mat({ color: '#17171a', roughness: 0.4, metalness: 0.2 });
  const bezel = box(1.02, 0.63, 0.05, bezelMat, 0, 1.2, -3.42);
  monitor.add(bezel);

  const screenMat = mat({
    color: '#0e0e10',
    emissive: new THREE.Color('#f3f0e8'),
    emissiveIntensity: 0.0,
    roughness: 0.32,
    metalness: 0.0,
  });
  const SCREEN_W = 0.92;
  const SCREEN_H = 0.53;
  const screen = new THREE.Mesh(track(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H)), screenMat);
  screen.position.set(0, 1.2, -3.394);
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
    screenMat.emissiveIntensity = on ? 0.55 : 0.28;
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
  const armMat = lampMat;
  const arm = box(0.36, 0.03, 0.03, armMat, 0.82, 1.2, -3.28);
  arm.rotation.z = -0.5;
  lamp.add(arm);
  const shade = new THREE.Mesh(track(new THREE.ConeGeometry(0.12, 0.16, 20, 1, true)), lampMat);
  shade.position.set(0.66, 1.12, -3.24);
  shade.rotation.z = Math.PI * 0.62;
  shade.castShadow = true;
  lamp.add(shade);
  scene.add(lamp);

  const lampLight = new THREE.PointLight(0xffd39a, 6, 3.2, 2);
  lampLight.position.set(0.62, 1.08, -3.1);
  lampLight.castShadow = false;
  scene.add(lampLight);
  // A little glow ball at the bulb so the source reads.
  const bulb = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.04, 12, 12)),
    mat({ color: '#fff1cf', emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 1.4, roughness: 1 }),
  );
  bulb.position.copy(lampLight.position);
  scene.add(bulb);

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

  // --- Shelves of ceramics (left wall) ---------------------------------------
  const shelfMat = mat({ color: '#8a6540', roughness: 0.6 });
  const potGeos = Object.values(POT_PRESETS).map((p) =>
    track(buildPotGeometry(THREE, { control: p.control, lobes: p.lobes, amp: p.amp, segments: 96 })),
  );

  const placePot = (x: number, y: number, z: number, presetIdx: number, scale: number, colorIdx: number) => {
    const geo = potGeos[presetIdx % potGeos.length];
    const clayMat = mat({
      color: CLAY_COLORS[colorIdx % CLAY_COLORS.length],
      roughness: 0.88,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const pot = new THREE.Mesh(geo, clayMat);
    // The generated geometry is centred; lift it so its base sits on the shelf.
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
    const shelf = box(0.34, 0.04, 1.9, shelfMat, -3.82, y, -0.3);
    scene.add(shelf);
    // A couple of brackets under each shelf.
    scene.add(box(0.28, 0.03, 0.03, shelfMat, -3.8, y - 0.05, -1.0 + i * 0.1));
    scene.add(box(0.28, 0.03, 0.03, shelfMat, -3.8, y - 0.05, 0.4 - i * 0.1));
  });
  // Scatter pots across the three shelves.
  placePot(-3.8, shelfLevels[0] + 0.02, -0.9, 0, 0.22, 0);
  placePot(-3.78, shelfLevels[0] + 0.02, -0.15, 2, 0.2, 1);
  placePot(-3.8, shelfLevels[0] + 0.02, 0.45, 3, 0.16, 4);
  placePot(-3.8, shelfLevels[1] + 0.02, -0.75, 1, 0.19, 3);
  placePot(-3.79, shelfLevels[1] + 0.02, 0.1, 4, 0.2, 2);
  placePot(-3.8, shelfLevels[2] + 0.02, -0.5, 3, 0.17, 5);
  placePot(-3.8, shelfLevels[2] + 0.02, 0.25, 0, 0.21, 6);
  // A hero pot on the desk corner as well.
  placePot(-1.05, 0.79, -3.3, 0, 0.16, 0);

  // --- Rug --------------------------------------------------------------------
  const rugMat = mat({ color: '#c96a4c', roughness: 1, metalness: 0 });
  const rug = new THREE.Mesh(track(new THREE.CircleGeometry(1.7, 40)), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.2, 0.004, -1.2);
  rug.receiveShadow = true;
  scene.add(rug);
  const rugInner = new THREE.Mesh(track(new THREE.RingGeometry(1.4, 1.5, 40)), mat({ color: '#e7d8c5', roughness: 1 }));
  rugInner.rotation.x = -Math.PI / 2;
  rugInner.position.set(0.2, 0.006, -1.2);
  scene.add(rugInner);

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
    const leaf = new THREE.Mesh(track(new THREE.ConeGeometry(0.08, 0.7 + Math.random() * 0.4, 6)), i % 2 ? leafMat : leafMat2);
    leaf.position.set(3.3 + (Math.random() - 0.5) * 0.24, 0.7 + Math.random() * 0.2, -3.1 + (Math.random() - 0.5) * 0.24);
    leaf.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.6);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  scene.add(plant);

  // --- Lighting ---------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xfff2e0, 0x6b5842, 0.7);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xfff4e6, 0.28);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
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

  const fill = new THREE.DirectionalLight(0xd6e6f0, 0.35);
  fill.position.set(3.5, 2.5, 3.5);
  scene.add(fill);

  scene.background = new THREE.Color('#efe7d7');
  scene.fog = new THREE.Fog(0xefe7d7, 10, 22);

  // --- Collision + bounds -----------------------------------------------------
  const colliders = [
    new THREE.Box3().setFromObject(desk),
    new THREE.Box3().setFromObject(chair),
    new THREE.Box3(new THREE.Vector3(3.05, 0, -3.35), new THREE.Vector3(3.55, 0.5, -2.85)), // plant pot
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
    useTargets: [bezel, screen],
    getScreenCorners,
    screenCenter,
    sit,
    stand,
    setScreenGlow,
    dispose,
  };
}
