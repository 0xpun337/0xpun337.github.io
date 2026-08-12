/** Backpressure simulation for the pipeline figure.
 *
 *  Deliberately DOM-free so it can be unit-tested without a browser — the
 *  canvas code in PipelineFigure.astro only draws what this produces. */

export type StageKey = 'scan' | 'io' | 'cpu' | 'db';

export interface Stage {
  name: string;
  runtime: 'tokio' | 'rayon';
  key: StageKey;
  baseRate: number;
}

export interface StageState {
  /** Items sitting in this stage's outbound queue. */
  q: number;
  /** Fractional item carried between ticks, so rates aren't quantised to the frame rate. */
  credit: number;
  stalled: boolean;
  busyMs: number;
  stallMs: number;
}

export interface SimParams {
  /** Bound on every inter-stage queue. This is the mechanism, not a tuning knob. */
  depth: number;
  /** Items/sec the database can absorb. */
  drain: number;
  /** Rayon pool size; 4 is the calibration point. */
  workers: number;
}

export const STAGES: readonly Stage[] = [
  { name: 'SCAN', runtime: 'tokio', key: 'scan', baseRate: 26 },
  { name: 'READ', runtime: 'tokio', key: 'io', baseRate: 22 },
  { name: 'DECODE', runtime: 'rayon', key: 'cpu', baseRate: 7 },
  { name: 'ENCODE', runtime: 'rayon', key: 'cpu', baseRate: 14 },
  { name: 'COPY', runtime: 'tokio', key: 'db', baseRate: 9 },
];

const LAST = STAGES.length - 1;

export function initState(): StageState[] {
  return STAGES.map(() => ({ q: 0, credit: 0, stalled: false, busyMs: 0, stallMs: 0 }));
}

/** Service rate of stage `i`. The last stage is the database, so its rate is
 *  the drain slider directly; Rayon stages scale with pool size. */
export function rateOf(i: number, p: SimParams): number {
  if (i === LAST) return p.drain;
  const s = STAGES[i];
  return s.runtime === 'rayon' ? s.baseRate * (p.workers / 4) : s.baseRate;
}

/** Advance by `dt` seconds. Mutates `state`; returns items completed this tick.
 *
 *  Walks downstream-first so a slot freed by the writer is visible to the
 *  encoder within the same tick. That ordering is the point: it makes a stall
 *  clear from the back of the pipeline forwards, the way the real one does. */
export function step(state: StageState[], p: SimParams, dt: number): number {
  let completed = 0;

  for (let i = LAST; i >= 0; i--) {
    const s = state[i];
    const isLast = i === LAST;
    const hasWork = i === 0 || state[i - 1].q > 0;
    const roomAhead = isLast || s.q < p.depth;

    if (!hasWork) {
      s.stalled = false;
      s.credit = 0;
      continue;
    }

    if (!roomAhead) {
      // Blocked on a full downstream queue. This is backpressure arriving.
      s.stalled = true;
      s.stallMs += dt;
      continue;
    }

    s.stalled = false;
    s.busyMs += dt;
    s.credit += rateOf(i, p) * dt;

    while (s.credit >= 1) {
      if (i > 0) {
        if (state[i - 1].q <= 0) break;
        state[i - 1].q--;
      }
      s.credit -= 1;
      if (isLast) {
        completed++;
      } else {
        s.q++;
        if (s.q >= p.depth) break;
      }
    }
  }

  return completed;
}
