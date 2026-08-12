import { describe, it, expect } from 'vitest';
import {
  DEFAULTS,
  initRuntime,
  laneFor,
  resync,
  stepRuntime,
  threadCount,
  utilisation,
  type RuntimeParams,
} from '../src/scripts/runtime-map';

function run(p: RuntimeParams, seconds = 20, dt = 1 / 60) {
  const s = initRuntime(p);
  for (let i = 0; i < seconds / dt; i++) stepRuntime(s, p, dt);
  return s;
}

describe('runtime occupancy model', () => {
  it('keeps the CPU phase off the reactor by default', () => {
    expect(laneFor('cpu', DEFAULTS)).toBe('rayon');
  });

  it('moves the CPU phase onto the reactor when asked', () => {
    expect(laneFor('cpu', { ...DEFAULTS, cpuOnReactor: true })).toBe('reactor');
  });

  it('leaves the reactor nearly idle when CPU work is offloaded', () => {
    const p = { ...DEFAULTS, cpuOnReactor: false };
    const s = run(p);
    // Reactor only does the 8ms write phase, so it should be lightly loaded.
    expect(utilisation(s, 'reactor', p)).toBeLessThan(0.25);
  });

  it('saturates the reactor when CPU work runs on it', () => {
    const p = { ...DEFAULTS, cpuOnReactor: true };
    const s = run(p);
    expect(utilisation(s, 'reactor', p)).toBeGreaterThan(0.9);
  });

  it('completes far more work with the CPU phase offloaded', () => {
    const offloaded = run({ ...DEFAULTS, cpuOnReactor: false });
    const onReactor = run({ ...DEFAULTS, cpuOnReactor: true });
    expect(offloaded.completed).toBeGreaterThan(onReactor.completed);
  });

  it('never assigns two jobs to the same thread slot', () => {
    const p = { ...DEFAULTS };
    const s = run(p, 10);
    for (const lane of ['blocking', 'reactor', 'rayon'] as const) {
      const busy = s.threads[lane].filter((x) => x !== null);
      expect(new Set(busy).size).toBe(busy.length);
    }
  });

  it('resync frees jobs stranded on removed threads', () => {
    const p = { ...DEFAULTS, rayonThreads: 6 };
    const s = run(p, 5);
    const shrunk = { ...p, rayonThreads: 2 };
    resync(s, shrunk);
    expect(s.threads.rayon.length).toBe(2);
    expect(threadCount('rayon', shrunk)).toBe(2);
    for (const job of s.jobs) {
      if (job.lane === 'rayon' && job.thread !== null) {
        expect(job.thread).toBeLessThan(2);
      }
    }
  });
});
