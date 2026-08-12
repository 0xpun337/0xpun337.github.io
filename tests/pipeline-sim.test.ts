import { describe, it, expect } from 'vitest';
import { STAGES, initState, rateOf, step, type SimParams } from '../src/scripts/pipeline-sim';

const P: SimParams = { depth: 8, drain: 9, workers: 4 };

function run(p: SimParams = P, ticks = 400, dt = 0.05) {
  const s = initState();
  let done = 0;
  for (let i = 0; i < ticks; i++) done += step(s, p, dt);
  return { s, done, seconds: ticks * dt };
}

describe('pipeline simulation', () => {
  it('never lets a queue exceed its bound', () => {
    const { s } = run();
    for (const st of s) expect(st.q).toBeLessThanOrEqual(P.depth);
  });

  it('propagates a slow drain all the way back to the scanner', () => {
    const { s } = run({ depth: 4, drain: 0.5, workers: 4 }, 600);
    expect(s[0].stalled).toBe(true);
  });

  it('does not stall the scanner when the database keeps up', () => {
    const { s } = run({ depth: 40, drain: 200, workers: 12 }, 600);
    expect(s[0].stallMs).toBe(0);
  });

  it('caps throughput at the drain rate', () => {
    const p = { depth: 40, drain: 5, workers: 12 };
    const { done, seconds } = run(p, 400, 0.05);
    expect(done).toBeLessThanOrEqual(p.drain * seconds + 2);
  });

  it('scales the rayon stages with worker count', () => {
    const i = STAGES.findIndex((s) => s.runtime === 'rayon');
    expect(rateOf(i, { ...P, workers: 8 })).toBeGreaterThan(rateOf(i, { ...P, workers: 2 }));
  });

  it('leaves the database rate untouched by worker count', () => {
    const last = STAGES.length - 1;
    expect(rateOf(last, { ...P, workers: 12 })).toBe(P.drain);
  });
});
