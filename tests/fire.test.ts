import { describe, it, expect } from 'vitest';
import { initFire, ignite, stepFire, emberColor, FIRE_DEFAULTS } from '../src/scripts/fire';

const tick = (s = initFire(), seconds = 1, dt = 1 / 60) => {
  let spawned = 0;
  for (let i = 0; i < seconds / dt; i++) spawned += stepFire(s, FIRE_DEFAULTS, dt, 0, 0, () => 0.5);
  return { s, spawned };
};

describe('dragon fire', () => {
  it('emits nothing until ignited', () => {
    const { s, spawned } = tick();
    expect(spawned).toBe(0);
    expect(s.embers).toHaveLength(0);
  });

  it('emits while breathing', () => {
    const s = initFire();
    ignite(s);
    const { spawned } = tick(s, 0.5);
    expect(spawned).toBeGreaterThan(0);
    expect(s.embers.length).toBeGreaterThan(0);
  });

  it('burns out on its own — a breath is not permanent', () => {
    const s = initFire();
    ignite(s, 0.4);
    tick(s, 5);
    expect(s.breathing).toBe(0);
    expect(s.embers).toHaveLength(0);
  });

  it('respects the ember cap under sustained breathing', () => {
    const s = initFire();
    for (let i = 0; i < 200; i++) {
      ignite(s, 2);
      stepFire(s, FIRE_DEFAULTS, 1 / 60, 0, 0, () => 0.5);
    }
    expect(s.embers.length).toBeLessThanOrEqual(FIRE_DEFAULTS.maxEmbers);
  });

  it('blows left and drifts upward', () => {
    const s = initFire();
    ignite(s);
    tick(s, 0.3);
    const avgX = s.embers.reduce((a, e) => a + e.x, 0) / s.embers.length;
    const avgY = s.embers.reduce((a, e) => a + e.y, 0) / s.embers.length;
    expect(avgX).toBeLessThan(0);
    expect(avgY).toBeLessThan(0);
  });

  it('cools from hot core to smoke', () => {
    expect(emberColor(1)[0]).toBe(255);
    expect(emberColor(0.05)[0]).toBe(120);
    for (const h of [-1, 0, 0.5, 1, 2]) {
      const [r, g, b, a] = emberColor(h);
      for (const v of [r, g, b]) expect(v).toBeGreaterThanOrEqual(0);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });

  it('never produces NaN', () => {
    const s = initFire();
    ignite(s, 3);
    tick(s, 4);
    for (const e of s.embers) {
      for (const v of [e.x, e.y, e.vx, e.vy, e.age, e.heat]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
