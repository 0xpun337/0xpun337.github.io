/** The post-open dragon splash: it pops in small, power-ups through discrete
 *  size steps, roars, then rockets off-screen and hands the page over.
 *
 *  Timing and staging live here, DOM-free, so the whole sequence — including
 *  "it always finishes and never traps the reader" — is testable. */

export type IntroPhase = 'grow' | 'roar' | 'exit' | 'done';

/** Discrete scale steps. Stepped rather than eased on purpose — the chunky
 *  jump is what makes it read as a power-up instead of a CSS transition. */
export const SCALE_STEPS = [1, 2, 3.2, 5, 7.5];
const STEP_AT = [0, 0.08, 0.17, 0.27, 0.37];

export const GROW_END = 0.46;
export const ROAR_END = 0.66;
export const EXIT_END = 1.12;

export interface IntroState {
  t: number;
  phase: IntroPhase;
  /** Sprite pixel multiplier. */
  scale: number;
  /** Horizontal offset as a fraction of viewport width; negative flies left. */
  x: number;
  /** Dragon opacity. */
  alpha: number;
  /** Backdrop opacity. */
  overlay: number;
  /** 0..1, jaw open. */
  jaw: number;
  /** True on the frame the roar starts, so the caller can kick off fire once. */
  justRoared: boolean;
}

export function initIntro(): IntroState {
  return {
    t: 0,
    phase: 'grow',
    scale: SCALE_STEPS[0],
    x: 0,
    alpha: 1,
    overlay: 1,
    jaw: 0,
    justRoared: false,
  };
}

/** Cut it short — a click, a key, anything. Jumps straight to the exit. */
export function skipIntro(s: IntroState): void {
  if (s.phase === 'done') return;
  s.t = Math.max(s.t, ROAR_END);
  s.phase = 'exit';
}

const easeIn = (u: number) => u * u * u;

export function stepIntro(s: IntroState, dt: number): IntroState {
  if (s.phase === 'done') return s;

  const wasRoar = s.phase === 'roar';
  s.t += dt;
  s.justRoared = false;

  if (s.t < GROW_END) {
    s.phase = 'grow';
    let step = 0;
    for (let i = 0; i < STEP_AT.length; i++) if (s.t >= STEP_AT[i]) step = i;
    s.scale = SCALE_STEPS[step];
    s.x = 0;
    s.alpha = 1;
    s.overlay = 1;
    s.jaw = 0;
  } else if (s.t < ROAR_END) {
    s.phase = 'roar';
    if (!wasRoar) s.justRoared = true;
    s.scale = SCALE_STEPS[SCALE_STEPS.length - 1];
    s.x = 0;
    s.alpha = 1;
    s.overlay = 1;
    s.jaw = 1;
  } else if (s.t < EXIT_END) {
    s.phase = 'exit';
    const u = (s.t - ROAR_END) / (EXIT_END - ROAR_END);
    s.scale = SCALE_STEPS[SCALE_STEPS.length - 1];
    s.x = -easeIn(u) * 1.9;
    s.alpha = 1 - Math.max(0, (u - 0.55) / 0.45);
    s.overlay = 1 - u;
    s.jaw = 1 - u * 0.6;
  } else {
    s.phase = 'done';
    s.alpha = 0;
    s.overlay = 0;
  }

  return s;
}
