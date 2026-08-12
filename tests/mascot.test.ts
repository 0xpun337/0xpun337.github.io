import { describe, it, expect } from 'vitest';
import {
  HEAD, JAW, HEAD_W, JAW_W,
  initMascot, setAct, stepMascot, formatEaten, DEFAULT_PARAMS,
} from '../src/scripts/mascot';

const run = (s = initMascot(), seconds = 5, dt = 1 / 60) => {
  let swallowed = 0;
  for (let i = 0; i < seconds / dt; i++) swallowed += stepMascot(s, DEFAULT_PARAMS, dt, () => 0.5);
  return { s, swallowed };
};

describe('mascot sprites', () => {
  it('has rows of consistent width', () => {
    for (const r of HEAD) expect(r).toHaveLength(HEAD_W);
    for (const r of JAW) expect(r).toHaveLength(JAW_W);
  });

  it('uses only known pixel keys', () => {
    const allowed = /^[.obhepnt]+$/;
    for (const r of [...HEAD, ...JAW]) expect(r).toMatch(allowed);
  });

  it('has an eye', () => {
    expect(HEAD.some((r) => r.includes('e'))).toBe(true);
    expect(HEAD.some((r) => r.includes('p'))).toBe(true);
  });
});

describe('mascot behaviour', () => {
  it('starts asleep and eats nothing', () => {
    const { s, swallowed } = run();
    expect(s.act).toBe('sleep');
    expect(swallowed).toBe(0);
    expect(s.blocks).toHaveLength(0);
    expect(s.eaten).toBe(0);
  });

  it('devours RAM once cued', () => {
    const s = initMascot();
    setAct(s, 'devour');
    const { swallowed } = run(s, 6);
    expect(swallowed).toBeGreaterThan(0);
    expect(s.eaten).toBeGreaterThan(0);
    expect(s.belly).toBeGreaterThan(0);
  });

  it('gets full and stops, rather than eating forever', () => {
    const s = initMascot();
    setAct(s, 'devour');
    run(s, 60);
    expect(s.belly).toBeLessThanOrEqual(1);
    expect(s.act).toBe('sated');
  });

  it('drops pending blocks when it goes back to sleep', () => {
    const s = initMascot();
    setAct(s, 'devour');
    run(s, 3);
    setAct(s, 'sleep');
    expect(s.blocks).toHaveLength(0);
  });

  it('digests over time but never below empty', () => {
    const s = initMascot();
    setAct(s, 'devour');
    run(s, 6);
    const full = s.belly;
    setAct(s, 'watch');
    run(s, 120);
    expect(s.belly).toBeLessThan(full);
    expect(s.belly).toBeGreaterThanOrEqual(0);
  });

  it('keeps the jaw shut when it is not eating', () => {
    const { s } = run();
    expect(s.jaw).toBe(0);
  });

  it('never produces NaN in any field', () => {
    const s = initMascot();
    setAct(s, 'devour');
    run(s, 30);
    for (const v of [s.jaw, s.belly, s.eaten, s.t, s.blink]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    for (const b of s.blocks) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    }
  });

  it('caps the block count so a long section cannot pile up forever', () => {
    const s = initMascot();
    setAct(s, 'devour');
    // Starve the mouth by moving it far away, so nothing gets swallowed.
    const far = { ...DEFAULT_PARAMS, blockSpeed: 0 };
    for (let i = 0; i < 3000; i++) stepMascot(s, far, 1 / 60, () => 0.5);
    expect(s.blocks.length).toBeLessThanOrEqual(14);
  });

  it('formats the counter in MB then GB', () => {
    expect(formatEaten(512)).toBe('512 MB');
    expect(formatEaten(2048)).toBe('2.0 GB');
  });
});
