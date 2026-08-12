/** A tiny stack VM, and one piece of bytecode that validates a key.
 *
 *  The disassembly is printed on the page on purpose. This is a fair crackme:
 *  everything you need is visible, and the arithmetic inverts cleanly. No
 *  devtools required, though nobody's stopping you. */

export const OPS = {
  LOAD: 0x01, // push input[operand]
  XOR: 0x02, // pop, xor operand, push
  ADD: 0x03, // pop, (+ operand) & 0xff, push
  ROL: 0x04, // pop, rotate left by operand within 8 bits, push
  CMP: 0x05, // pop, fail unless equal to operand
  LEN: 0x06, // fail unless input length equals operand
  HALT: 0x07,
} as const;

export const OP_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(OPS).map(([k, v]) => [v, k]),
);

const rol8 = (v: number, n: number) => ((v << n) | (v >>> (8 - n))) & 0xff;
const ror8 = (v: number, n: number) => ((v >>> n) | (v << (8 - n))) & 0xff;

/** Per-index transform constants. Arbitrary, but fixed — they're in the
 *  disassembly, which is the whole point. */
const MASK = [0x5a, 0x3c, 0x91, 0x7e, 0x2d, 0xc4, 0x68, 0xb3];
const ADD = [0x11, 0x2f, 0x07, 0x5c, 0x93, 0x40, 0x1d, 0x76];
const ROT = [3, 5, 1, 6, 2, 7, 4, 3];

/** The key the bytecode accepts. Eight characters. */
const KEY = '0xC0FFEE';

/** Forward transform, mirrored exactly by the emitted opcodes. */
function transform(code: number, i: number): number {
  let v = code & 0xff;
  v = v ^ MASK[i];
  v = (v + ADD[i]) & 0xff;
  v = rol8(v, ROT[i]);
  return v;
}

/** Invert the transform — this is the intended solution path. */
export function solveChar(target: number, i: number): number {
  let v = ror8(target, ROT[i]);
  v = (v - ADD[i] + 0x100) & 0xff;
  v = v ^ MASK[i];
  return v;
}

export interface Instr {
  op: number;
  operand: number;
  /** Byte offset of this instruction in the program. */
  at: number;
}

function build(): Instr[] {
  const out: Instr[] = [];
  let at = 0;
  const push = (op: number, operand: number) => {
    out.push({ op, operand, at });
    at += 2;
  };

  push(OPS.LEN, KEY.length);
  for (let i = 0; i < KEY.length; i++) {
    push(OPS.LOAD, i);
    push(OPS.XOR, MASK[i]);
    push(OPS.ADD, ADD[i]);
    push(OPS.ROL, ROT[i]);
    push(OPS.CMP, transform(KEY.charCodeAt(i), i));
  }
  push(OPS.HALT, 0);
  return out;
}

export const PROGRAM: Instr[] = build();

export interface TraceStep {
  pc: number;
  instr: Instr;
  /** Stack top after executing, or null when the stack is empty. */
  top: number | null;
  failedHere: boolean;
}

export interface RunResult {
  ok: boolean;
  trace: TraceStep[];
  /** Index of the first instruction that rejected, or -1. */
  failedAt: number;
}

export function run(input: string): RunResult {
  const stack: number[] = [];
  const trace: TraceStep[] = [];
  let ok = true;
  let failedAt = -1;

  for (let pc = 0; pc < PROGRAM.length; pc++) {
    const instr = PROGRAM[pc];
    let failedHere = false;

    switch (instr.op) {
      case OPS.LEN:
        if (input.length !== instr.operand) failedHere = true;
        break;
      case OPS.LOAD:
        stack.push(input.charCodeAt(instr.operand) & 0xff || 0);
        break;
      case OPS.XOR:
        stack.push((stack.pop()! ^ instr.operand) & 0xff);
        break;
      case OPS.ADD:
        stack.push((stack.pop()! + instr.operand) & 0xff);
        break;
      case OPS.ROL:
        stack.push(rol8(stack.pop()!, instr.operand));
        break;
      case OPS.CMP:
        if (stack.pop() !== instr.operand) failedHere = true;
        break;
      case OPS.HALT:
        break;
    }

    if (failedHere && ok) {
      ok = false;
      failedAt = pc;
    }

    trace.push({
      pc,
      instr,
      top: stack.length ? stack[stack.length - 1] : null,
      failedHere,
    });
  }

  return { ok, trace, failedAt };
}

const hx = (n: number) => '0x' + n.toString(16).padStart(2, '0').toUpperCase();

export function disassemble(): string[] {
  return PROGRAM.map((i) => {
    const name = OP_NAMES[i.op].padEnd(5);
    const operand =
      i.op === OPS.LOAD || i.op === OPS.LEN || i.op === OPS.ROL
        ? String(i.operand)
        : hx(i.operand);
    return `${i.at.toString(16).padStart(4, '0')}  ${name} ${operand}`;
  });
}
