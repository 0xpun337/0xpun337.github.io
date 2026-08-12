import { describe, it, expect } from 'vitest';
import {
  initIntro, stepIntro, skipIntro, SCALE_STEPS, EXIT_END,
} from '../src/scripts/intro';

const play = (seconds: number, dt = 1 / 60) => {
  const s = initIntro();
  for (let i = 0; i < seconds / dt; i++) stepIntro(s, dt);
  return s;
};

describe('post-open dragon splash', () => {
  it('starts small and grows through discrete steps, never between them', () => {
    const s = initIntro();
    const seen = new Set<number>();
    for (let i = 0; i < 30; i++) {
      stepIntro(s, 1 / 60);
      seen.add(s.scale);
    }
    for (const v of seen) expect(SCALE_STEPS).toContain(v);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('runs grow → roar → exit → done in order', () => {
    const s = initIntro();
    const order: string[] = [];
    for (let i = 0; i < 120; i++) {
      stepIntro(s, 1 / 60);
      if (order.at(-1) !== s.phase) order.push(s.phase);
    }
    expect(order).toEqual(['grow', 'roar', 'exit', 'done']);
  });

  it('signals the roar exactly once, so fire is not re-triggered every frame', () => {
    const s = initIntro();
    let roars = 0;
    for (let i = 0; i < 120; i++) {
      stepIntro(s, 1 / 60);
      if (s.justRoared) roars++;
    }
    expect(roars).toBe(1);
  });

  it('always finishes and clears the overlay — it can never trap the reader', () => {
    const s = play(EXIT_END + 0.5);
    expect(s.phase).toBe('done');
    expect(s.overlay).toBe(0);
    expect(s.alpha).toBe(0);
  });

  it('finishes regardless of frame rate, including long stalls', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 15, 0.25]) {
      const s = initIntro();
      for (let i = 0; i < Math.ceil(3 / dt); i++) stepIntro(s, dt);
      expect(s.phase, `dt=${dt}`).toBe('done');
    }
  });

  it('skipping jumps to the exit and still lands on done', () => {
    const s = initIntro();
    stepIntro(s, 1 / 60);
    skipIntro(s);
    stepIntro(s, 1 / 60);
    expect(s.phase).toBe('exit');
    for (let i = 0; i < 60; i++) stepIntro(s, 1 / 60);
    expect(s.phase).toBe('done');
    expect(s.overlay).toBe(0);
  });

  it('skipping after it is done is a no-op', () => {
    const s = play(2);
    skipIntro(s);
    expect(s.phase).toBe('done');
  });

  it('flies left and fades on the way out', () => {
    const s = initIntro();
    for (let i = 0; i < 60; i++) stepIntro(s, 1 / 60);
    expect(s.x).toBeLessThan(0);
    const mid = s.overlay;
    for (let i = 0; i < 10; i++) stepIntro(s, 1 / 60);
    expect(s.overlay).toBeLessThan(mid);
  });

  it('never produces NaN or a negative opacity', () => {
    const s = initIntro();
    for (let i = 0; i < 200; i++) {
      stepIntro(s, 1 / 60);
      for (const v of [s.t, s.scale, s.x, s.alpha, s.overlay, s.jaw]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.overlay).toBeGreaterThanOrEqual(0);
    }
  });
});
