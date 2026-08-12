/** Thread-occupancy model for the two-runtime figure.
 *
 *  The point it exists to demonstrate: where the CPU phase runs decides
 *  whether the async reactor stays free. Flip `cpuOnReactor` and the same
 *  workload saturates the reactor instead of the pinned pool.
 *
 *  DOM-free so it can be unit-tested. */

export type Lane = 'blocking' | 'reactor' | 'rayon';
export type Phase = 'read' | 'cpu' | 'write' | 'done';

/** Milliseconds of work each phase costs. Read is a syscall; cpu is
 *  decrypt + parse + validate; write is handing a row to the writer. */
export const PHASE_MS: Record<Exclude<Phase, 'done'>, number> = {
  read: 55,
  cpu: 150,
  write: 20,
};

export interface Job {
  id: number;
  phase: Phase;
  /** Work left in the current phase, ms. */
  left: number;
  /** Index into the lane's thread array, or null when queued. */
  thread: number | null;
  lane: Lane | null;
  /** Total ms from admission to done, filled in when the job finishes. */
  latency: number;
  age: number;
}

export interface RuntimeParams {
  blockingThreads: number;
  reactorThreads: number;
  rayonThreads: number;
  /** The whole argument: run decrypt/parse on the reactor instead of Rayon. */
  cpuOnReactor: boolean;
  /** Jobs admitted per second. */
  arrivalRate: number;
}

export interface RuntimeState {
  jobs: Job[];
  /** Per-lane arrays of job id or null. */
  threads: Record<Lane, (number | null)[]>;
  /** Accumulated busy-ms per lane, for utilisation readouts. */
  busyMs: Record<Lane, number>;
  elapsed: number;
  admitted: number;
  completed: number;
  latencySum: number;
  spawnCredit: number;
}

export const DEFAULTS: RuntimeParams = {
  blockingThreads: 8,
  reactorThreads: 4,
  rayonThreads: 6,
  cpuOnReactor: false,
  arrivalRate: 30,
};

/** Which lane a phase runs on. `cpu` is the only one that moves. */
export function laneFor(phase: Phase, p: RuntimeParams): Lane | null {
  if (phase === 'read') return 'blocking';
  if (phase === 'write') return 'reactor';
  if (phase === 'cpu') return p.cpuOnReactor ? 'reactor' : 'rayon';
  return null;
}

export function threadCount(lane: Lane, p: RuntimeParams): number {
  if (lane === 'blocking') return p.blockingThreads;
  if (lane === 'reactor') return p.reactorThreads;
  return p.rayonThreads;
}

export function initRuntime(p: RuntimeParams = DEFAULTS): RuntimeState {
  return {
    jobs: [],
    threads: {
      blocking: new Array(p.blockingThreads).fill(null),
      reactor: new Array(p.reactorThreads).fill(null),
      rayon: new Array(p.rayonThreads).fill(null),
    },
    busyMs: { blocking: 0, reactor: 0, rayon: 0 },
    elapsed: 0,
    admitted: 0,
    completed: 0,
    latencySum: 0,
    spawnCredit: 0,
  };
}

/** Resize thread arrays in place when a slider moves, preserving assignments
 *  that still fit. Without this, changing pool size would strand running jobs
 *  on threads that no longer exist. */
export function resync(s: RuntimeState, p: RuntimeParams): void {
  (['blocking', 'reactor', 'rayon'] as Lane[]).forEach((lane) => {
    const want = threadCount(lane, p);
    const cur = s.threads[lane];
    if (cur.length === want) return;
    if (want < cur.length) {
      for (let i = want; i < cur.length; i++) {
        const id = cur[i];
        if (id !== null) {
          const job = s.jobs.find((j) => j.id === id);
          if (job) {
            job.thread = null;
            job.lane = null;
          }
        }
      }
      cur.length = want;
    } else {
      while (cur.length < want) cur.push(null);
    }
  });
}

/** Advance by `dt` seconds. Returns the number of jobs completed this tick. */
export function stepRuntime(s: RuntimeState, p: RuntimeParams, dt: number): number {
  s.elapsed += dt;

  // Admit new work.
  s.spawnCredit += p.arrivalRate * dt;
  while (s.spawnCredit >= 1) {
    s.spawnCredit -= 1;
    // Cap the backlog so a saturated reactor doesn't grow an unbounded array.
    if (s.jobs.length < 400) {
      s.jobs.push({
        id: s.admitted++,
        phase: 'read',
        left: PHASE_MS.read,
        thread: null,
        lane: null,
        latency: 0,
        age: 0,
      });
    }
  }

  // Assign queued jobs to free threads on their phase's lane.
  for (const job of s.jobs) {
    if (job.phase === 'done' || job.thread !== null) continue;
    const lane = laneFor(job.phase, p);
    if (!lane) continue;
    const slots = s.threads[lane];
    const free = slots.indexOf(null);
    if (free !== -1) {
      slots[free] = job.id;
      job.thread = free;
      job.lane = lane;
    }
  }

  // Burn work.
  const dtMs = dt * 1000;
  let completed = 0;

  for (const job of s.jobs) {
    if (job.phase === 'done') continue;
    job.age += dtMs;
    if (job.thread === null || job.lane === null) continue;

    s.busyMs[job.lane] += dtMs;
    job.left -= dtMs;
    if (job.left > 0) continue;

    // Phase finished — release the thread.
    s.threads[job.lane][job.thread] = null;
    job.thread = null;
    const finishedOn = job.lane;
    job.lane = null;

    if (job.phase === 'read') {
      job.phase = 'cpu';
      job.left = PHASE_MS.cpu;
    } else if (job.phase === 'cpu') {
      job.phase = 'write';
      job.left = PHASE_MS.write;
    } else {
      job.phase = 'done';
      job.latency = job.age;
      s.latencySum += job.latency;
      s.completed++;
      completed++;
    }
    void finishedOn;
  }

  // Drop finished jobs.
  if (s.jobs.length > 0) s.jobs = s.jobs.filter((j) => j.phase !== 'done');

  return completed;
}

/** Fraction of lane capacity consumed over the run so far, 0..1. */
export function utilisation(s: RuntimeState, lane: Lane, p: RuntimeParams): number {
  const capacityMs = threadCount(lane, p) * s.elapsed * 1000;
  if (capacityMs <= 0) return 0;
  return Math.min(1, s.busyMs[lane] / capacityMs);
}
