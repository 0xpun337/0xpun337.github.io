/** The in-post mascot's brain.
 *
 *  DOM-free so the behaviour is testable: acts, chomping, belly fullness, and
 *  the block physics all live here. Artwork comes from ./dragon-sprite. */

export type Act = 'sleep' | 'watch' | 'devour' | 'sated';

export { HEAD, JAW, HEAD_W, JAW_W } from './dragon-sprite';

export interface Block {
  /** Position in sprite-pixel space, relative to the mascot box. */
  x: number;
  y: number;
  size: number;
  mb: number;
  /** 0 = whole, 1 = fully swallowed. */
  chewed: number;
}

export interface MascotState {
  act: Act;
  /** 0 closed .. 1 fully open. */
  jaw: number;
  /** 0 empty .. 1 stuffed. */
  belly: number;
  /** Megabytes devoured, for the counter. */
  eaten: number;
  blocks: Block[];
  /** Seconds in the current act. */
  t: number;
  /** 0..1, drives the idle blink. */
  blink: number;
  nextBlink: number;
  nextSpawn: number;
}

export interface MascotParams {
  /** Blocks per second while devouring. */
  spawnRate: number;
  /** Sprite pixels per second a block travels toward the mouth. */
  blockSpeed: number;
  /** Where the mouth is, in sprite-pixel space. */
  mouthX: number;
  mouthY: number;
}

export const DEFAULT_PARAMS: MascotParams = {
  spawnRate: 2.4,
  blockSpeed: 26,
  mouthX: 2,
  mouthY: 8,
};

export function initMascot(): MascotState {
  return {
    act: 'sleep',
    jaw: 0,
    belly: 0,
    eaten: 0,
    blocks: [],
    t: 0,
    blink: 0,
    nextBlink: 2.5,
    nextSpawn: 0,
  };
}

export function setAct(s: MascotState, act: Act): void {
  if (s.act === act) return;
  s.act = act;
  s.t = 0;
  if (act === 'devour') {
    s.nextSpawn = 0;
  }
  if (act === 'sleep' || act === 'watch') {
    s.blocks = [];
    // Digest slowly rather than snapping back to empty.
  }
}

const BLOCK_SIZES = [4, 5, 6, 7];
const BLOCK_MB = [64, 128, 256, 512];

/** Advance by `dt` seconds. Returns the number of blocks swallowed this tick. */
export function stepMascot(
  s: MascotState,
  p: MascotParams = DEFAULT_PARAMS,
  dt: number,
  rand: () => number = Math.random,
): number {
  s.t += dt;
  let swallowed = 0;

  // Idle blink, any act.
  s.nextBlink -= dt;
  if (s.nextBlink <= 0) {
    s.blink = 1;
    s.nextBlink = 2 + rand() * 4;
  }
  s.blink = Math.max(0, s.blink - dt * 7);

  if (s.act === 'devour') {
    s.nextSpawn -= dt;
    if (s.nextSpawn <= 0 && s.blocks.length < 14) {
      s.nextSpawn = 1 / p.spawnRate;
      const i = Math.floor(rand() * BLOCK_SIZES.length);
      s.blocks.push({
        // Enter from the right edge of the box, drifting toward the mouth.
        x: 34 + rand() * 14,
        y: 2 + rand() * 12,
        size: BLOCK_SIZES[i],
        mb: BLOCK_MB[i],
        chewed: 0,
      });
    }
  }

  // Move blocks toward the mouth and swallow the ones that arrive.
  for (const b of s.blocks) {
    if (b.chewed > 0) {
      b.chewed = Math.min(1, b.chewed + dt * 5);
      continue;
    }
    const dx = p.mouthX - b.x;
    const dy = p.mouthY - b.y;
    const d = Math.hypot(dx, dy) || 1;
    const travel = p.blockSpeed * dt;
    if (d <= travel + b.size * 0.5) {
      b.chewed = 0.001;
      swallowed++;
      s.eaten += b.mb;
      s.belly = Math.min(1, s.belly + 0.09);
      s.jaw = 1;
    } else {
      b.x += (dx / d) * travel;
      b.y += (dy / d) * travel;
    }
  }
  s.blocks = s.blocks.filter((b) => b.chewed < 1);

  // Jaw closes fast after a chomp; opens a crack while hunting.
  const target = s.act === 'devour' ? (s.blocks.length ? 0.35 : 0.15) : 0;
  s.jaw += (target - s.jaw) * Math.min(1, dt * 9);
  if (s.jaw < 0.001) s.jaw = 0;

  // Digest when not eating.
  if (s.act !== 'devour' && s.belly > 0) {
    s.belly = Math.max(0, s.belly - dt * 0.06);
  }

  // A full dragon stops being hungry.
  if (s.act === 'devour' && s.belly >= 1) setAct(s, 'sated');

  return swallowed;
}

export function formatEaten(mb: number): string {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
  return mb + ' MB';
}
