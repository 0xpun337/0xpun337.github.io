/** Flame particles for the hero dragon. DOM-free so it stays testable. */

export interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived so far. */
  age: number;
  life: number;
  size: number;
  /** 0..1, drives the hot-to-smoke colour ramp. */
  heat: number;
}

export interface FireParams {
  /** Embers per second while breathing. */
  rate: number;
  /** Horizontal speed, sprite-pixels/sec. Negative blows left. */
  speed: number;
  spread: number;
  /** Upward drift, since hot gas rises. */
  buoyancy: number;
  maxEmbers: number;
}

export const FIRE_DEFAULTS: FireParams = {
  rate: 260,
  speed: -210,
  spread: 52,
  buoyancy: -30,
  maxEmbers: 520,
};

export interface FireState {
  embers: Ember[];
  /** Seconds of breath left. */
  breathing: number;
  spawnCredit: number;
}

export function initFire(): FireState {
  return { embers: [], breathing: 0, spawnCredit: 0 };
}

/** Start (or extend) a breath. */
export function ignite(s: FireState, seconds = 0.9): void {
  s.breathing = Math.max(s.breathing, seconds);
}

/** Advance by `dt` seconds from a mouth at (mx, my). Returns embers spawned. */
export function stepFire(
  s: FireState,
  p: FireParams,
  dt: number,
  mx: number,
  my: number,
  rand: () => number = Math.random,
): number {
  let spawned = 0;

  if (s.breathing > 0) {
    s.breathing = Math.max(0, s.breathing - dt);
    s.spawnCredit += p.rate * dt;
    while (s.spawnCredit >= 1) {
      s.spawnCredit -= 1;
      if (s.embers.length >= p.maxEmbers) {
        s.spawnCredit = 0;
        break;
      }
      const spread = (rand() - 0.5) * p.spread;
      s.embers.push({
        x: mx,
        y: my + (rand() - 0.5) * 5,
        vx: p.speed * (0.6 + rand() * 0.7),
        vy: spread,
        age: 0,
        life: 0.75 + rand() * 0.95,
        size: 3.5 + rand() * 6.5,
        heat: 1,
      });
      spawned++;
    }
  } else {
    s.spawnCredit = 0;
  }

  for (const e of s.embers) {
    e.age += dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt + p.buoyancy * dt * (e.age / e.life);
    // Drag, so the jet slows into a lazy plume rather than flying forever.
    e.vx *= 1 - Math.min(0.9, dt * 1.9);
    e.heat = Math.max(0, 1 - e.age / e.life);
  }

  s.embers = s.embers.filter((e) => e.age < e.life);
  return spawned;
}

/** Blackbody-ish ramp: white-yellow core → yellow → orange → red → smoke.
 *  More steps than strictly necessary, because the yellow-to-orange band is
 *  what makes a flame read as fire rather than as orange confetti.
 *  Returns [r,g,b,alpha]. */
export function emberColor(heat: number): [number, number, number, number] {
  const h = Math.max(0, Math.min(1, heat));
  if (h > 0.86) return [255, 253, 228, h];           // white-yellow core
  if (h > 0.68) return [255, 232, 120, h];           // bright yellow
  if (h > 0.5) return [255, 186, 48, h];             // yellow-orange
  if (h > 0.34) return [248, 138, 26, h];            // orange
  if (h > 0.2) return [222, 88, 22, h * 0.97];       // deep orange
  if (h > 0.09) return [166, 46, 20, h * 0.9];       // red ember
  return [120, 116, 120, h * 0.75];                  // smoke
}
