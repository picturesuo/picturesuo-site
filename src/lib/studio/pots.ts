/**
 * pots — the procedural lathe-turned vessel generator, factored out of
 * ClayHero so the studio's shelves of ceramics and the hero pot share one
 * silhouette maker. A 2D profile of (radius, height) control points is smoothed
 * into a spline, revolved into a solid, and given gentle N-lobed vertical
 * fluting so a hand-thrown pot never reads as a perfect solid of revolution.
 *
 * three is passed in rather than imported here, so callers keep control of when
 * the (heavy) three chunk loads and this module never pins it onto a page that
 * does not want it.
 */
type ThreeModule = typeof import('three');
type LatheGeometry = import('three').LatheGeometry;

export interface PotOptions {
  /** Profile control points as [radius, height] pairs, bottom to rim. */
  control?: Array<[number, number]>;
  /** Radial segments around the axis. */
  segments?: number;
  /** Number of fluting lobes around the pot. */
  lobes?: number;
  /** Fluting amplitude, as a fraction of local radius. */
  amp?: number;
  /** How many points to sample the smoothed profile spline into. */
  profileSamples?: number;
  /** Recentre the form vertically around its middle. */
  center?: boolean;
}

/** The signature ClayHero silhouette: narrow foot, full belly, drawn-in neck, flared lip. */
export const HERO_PROFILE: Array<[number, number]> = [
  [0.0, 0.0], // base centre (closes the bottom)
  [0.32, 0.0], // foot edge
  [0.35, 0.13],
  [0.5, 0.38],
  [0.63, 0.72],
  [0.66, 1.0], // widest belly
  [0.6, 1.3],
  [0.47, 1.6], // shoulder draws in
  [0.37, 1.85], // neck
  [0.35, 2.0],
  [0.42, 2.18], // flared lip
  [0.43, 2.26], // rim
];

/**
 * A small library of studio silhouettes so a shelf of pots reads as a set of
 * hand-made objects rather than copies. Heights are normalised-ish; callers
 * scale per instance.
 */
export const POT_PRESETS: Record<string, { control: Array<[number, number]>; lobes: number; amp: number }> = {
  hero: { control: HERO_PROFILE, lobes: 9, amp: 0.03 },
  // A tall, slender bud vase with a pinched neck.
  budVase: {
    control: [
      [0.0, 0.0],
      [0.26, 0.0],
      [0.28, 0.1],
      [0.4, 0.5],
      [0.44, 0.95],
      [0.38, 1.5],
      [0.22, 2.1],
      [0.18, 2.5],
      [0.24, 2.85],
      [0.25, 2.95],
    ],
    lobes: 12,
    amp: 0.02,
  },
  // A wide, shallow serving bowl.
  bowl: {
    control: [
      [0.0, 0.0],
      [0.3, 0.0],
      [0.34, 0.06],
      [0.55, 0.28],
      [0.78, 0.6],
      [0.9, 0.86],
      [0.92, 0.95],
      [0.88, 0.98],
    ],
    lobes: 7,
    amp: 0.035,
  },
  // A straight-walled tumbler / beaker.
  tumbler: {
    control: [
      [0.0, 0.0],
      [0.34, 0.0],
      [0.36, 0.08],
      [0.4, 0.5],
      [0.42, 1.0],
      [0.44, 1.5],
      [0.45, 1.72],
      [0.44, 1.78],
    ],
    lobes: 16,
    amp: 0.015,
  },
  // A round-bellied bottle with a long narrow neck.
  bottle: {
    control: [
      [0.0, 0.0],
      [0.3, 0.0],
      [0.34, 0.12],
      [0.55, 0.5],
      [0.62, 0.9],
      [0.58, 1.25],
      [0.34, 1.6],
      [0.18, 1.95],
      [0.17, 2.4],
      [0.2, 2.6],
      [0.19, 2.68],
    ],
    lobes: 10,
    amp: 0.025,
  },
};

/** Warm, unglazed-to-glazed clay colours drawn from the site palette family. */
export const CLAY_COLORS = ['#c46a50', '#b8825a', '#8f6f52', '#a5553f', '#d18b64', '#7d8a6f', '#6f6152'];

/**
 * Build a lathe-turned vessel geometry. Returns a LatheGeometry with computed
 * normals; the caller owns disposal.
 */
export function buildPotGeometry(THREE: ThreeModule, opts: PotOptions = {}): LatheGeometry {
  const {
    control = HERO_PROFILE,
    segments = 128,
    lobes = 9,
    amp = 0.03,
    profileSamples = 80,
    center = true,
  } = opts;

  const points = control.map(([x, y]) => new THREE.Vector2(x, y));
  const profile = new THREE.SplineCurve(points).getPoints(profileSamples);
  const geometry = new THREE.LatheGeometry(profile, segments);

  // Gentle vertical fluting: nudge each ring's radius by a soft N-lobed wave so
  // subtle facets catch the light instead of a mirror-smooth surface.
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-4) continue;
    const theta = Math.atan2(z, x);
    const f = 1 + amp * Math.cos(lobes * theta);
    pos.setX(i, x * f);
    pos.setZ(i, z * f);
  }
  pos.needsUpdate = true;

  if (center) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox!;
    geometry.translate(0, -(bb.max.y + bb.min.y) / 2, 0);
  }
  geometry.computeVertexNormals();
  return geometry;
}
