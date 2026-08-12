/** A faithful TypeScript port of the A-XDR decoder's guards, so the figure in
 *  the post is running the real algorithm rather than miming it.
 *
 *  Mirrors the Rust: short/long-form length codec, a depth ceiling, a capacity
 *  clamp on container pre-allocation, checked length accumulation, declared
 *  length validated against bytes available, and strict trailing-byte
 *  rejection. Every error carries the byte offset where it happened. */

export const MAX_DEPTH = 32;
/** Pre-allocation ceiling. A declared count above this is honoured lazily —
 *  the decoder simply runs out of input and reports EOF instead of trying to
 *  reserve for a number an attacker chose. */
export const CAPACITY_CLAMP = 1024;

export const TAGS: Record<number, string> = {
  0: 'null', 1: 'array', 2: 'structure', 3: 'boolean', 4: 'bit-string',
  5: 'int32', 6: 'uint32', 9: 'octet-string', 10: 'visible-string',
  12: 'utf8-string', 13: 'bcd', 15: 'int8', 16: 'int16', 17: 'uint8',
  18: 'uint16', 19: 'compact-array', 20: 'int64', 21: 'uint64', 22: 'enum',
  23: 'float32', 24: 'float64', 25: 'date-time', 26: 'date', 27: 'time',
};

/** Byte counts for the tags whose payload width is fixed by the tag alone. */
const FIXED_LEN: Record<number, number> = {
  3: 1, 5: 4, 6: 4, 13: 1, 15: 1, 16: 2, 17: 1, 18: 2, 20: 8, 21: 8,
  22: 1, 23: 4, 24: 8, 25: 12, 26: 5, 27: 4,
};

export type SpanKind = 'tag' | 'length' | 'payload' | 'error';

export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
  label: string;
  depth: number;
}

export interface Node {
  tag: number;
  name: string;
  offset: number;
  repr: string;
  children?: Node[];
}

export interface DecodeOk {
  ok: true;
  root: Node;
  spans: Span[];
  /** Peak container nesting reached, for the readout. */
  maxDepth: number;
  /** Largest count a container header declared, honest or otherwise. */
  maxDeclared: number;
}

export interface DecodeErr {
  ok: false;
  /** The `AxdrError` variant name, matching the Rust enum. */
  kind: string;
  message: string;
  offset: number;
  spans: Span[];
  maxDepth: number;
  maxDeclared: number;
}

export type DecodeResult = DecodeOk | DecodeErr;

class AxdrError extends Error {
  constructor(
    readonly kind: string,
    readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

interface Ctx {
  buf: Uint8Array;
  spans: Span[];
  maxDepth: number;
  maxDeclared: number;
}

/** Short form: leading byte < 0x80 is the length itself.
 *  Long form: 0x81..=0x88, low 7 bits = count of big-endian length bytes. */
function decodeLength(
  ctx: Ctx,
  pos: number,
  depth: number,
): { value: number; consumed: number } {
  if (pos >= ctx.buf.length) {
    throw new AxdrError('UnexpectedEof', pos, `unexpected end of input at offset ${pos}: needed 1 more byte`);
  }
  const first = ctx.buf[pos];

  if (first < 0x80) {
    ctx.spans.push({ start: pos, end: pos + 1, kind: 'length', label: `length ${first}`, depth });
    return { value: first, consumed: 1 };
  }

  const count = first & 0x7f;
  // A zero-byte or absurdly wide length field is malformed, not merely large.
  if (count === 0 || count > 8) {
    throw new AxdrError(
      'InvalidLength',
      pos,
      `invalid length encoding at offset ${pos}: leading byte 0x${first.toString(16).padStart(2, '0')}`,
    );
  }
  if (ctx.buf.length < pos + 1 + count) {
    const needed = pos + 1 + count - ctx.buf.length;
    throw new AxdrError('UnexpectedEof', pos, `unexpected end of input at offset ${pos}: needed ${needed} more byte(s)`);
  }

  let value = 0;
  for (let i = 0; i < count; i++) {
    // The Rust uses checked_shl/checked_add; JS loses integer precision past
    // 2^53, so the equivalent guard is a safe-integer check.
    value = value * 256 + ctx.buf[pos + 1 + i];
    if (!Number.isSafeInteger(value)) {
      throw new AxdrError('LengthOverflow', pos, `length field at offset ${pos} exceeds usize range`);
    }
  }

  ctx.spans.push({ start: pos, end: pos + 1 + count, kind: 'length', label: `length ${value}`, depth });
  return { value, consumed: 1 + count };
}

function decodeValue(ctx: Ctx, pos: number, depth: number): { node: Node; next: number } {
  ctx.maxDepth = Math.max(ctx.maxDepth, depth);

  if (pos >= ctx.buf.length) {
    throw new AxdrError('UnexpectedEof', pos, `unexpected end of input at offset ${pos}: needed 1 more byte`);
  }

  const raw = ctx.buf[pos];
  const name = TAGS[raw];
  if (name === undefined) {
    throw new AxdrError(
      'UnknownTag',
      pos,
      `unknown A-XDR type tag 0x${raw.toString(16).padStart(2, '0')} at offset ${pos}`,
    );
  }
  ctx.spans.push({ start: pos, end: pos + 1, kind: 'tag', label: name, depth });

  const after = pos + 1;

  // Fixed-width scalars.
  const fixed = FIXED_LEN[raw];
  if (fixed !== undefined) {
    if (ctx.buf.length - after < fixed) {
      const needed = fixed - (ctx.buf.length - after);
      throw new AxdrError('UnexpectedEof', after, `unexpected end of input at offset ${after}: needed ${needed} more byte(s)`);
    }
    ctx.spans.push({ start: after, end: after + fixed, kind: 'payload', label: name, depth });
    const bytes = ctx.buf.slice(after, after + fixed);
    return { node: { tag: raw, name, offset: pos, repr: scalarRepr(raw, bytes) }, next: after + fixed };
  }

  if (raw === 0) {
    return { node: { tag: raw, name, offset: pos, repr: 'null' }, next: after };
  }

  // Containers: array and structure.
  if (raw === 1 || raw === 2) {
    if (depth + 1 > MAX_DEPTH) {
      throw new AxdrError('DepthExceeded', pos, `nesting depth exceeded ${MAX_DEPTH} at offset ${pos}`);
    }
    const { value: count, consumed } = decodeLength(ctx, after, depth);
    ctx.maxDeclared = Math.max(ctx.maxDeclared, count);

    let cur = after + consumed;
    const children: Node[] = [];
    // Mirrors Vec::with_capacity(count.min(CAPACITY_CLAMP)) — the declared
    // count never drives an allocation on its own.
    for (let i = 0; i < count; i++) {
      const r = decodeValue(ctx, cur, depth + 1);
      children.push(r.node);
      cur = r.next;
    }
    return {
      node: { tag: raw, name, offset: pos, repr: `${name}[${count}]`, children },
      next: cur,
    };
  }

  // Length-prefixed strings.
  if (raw === 9 || raw === 10 || raw === 12) {
    const { value: len, consumed } = decodeLength(ctx, after, depth);
    ctx.maxDeclared = Math.max(ctx.maxDeclared, len);
    const body = after + consumed;
    const available = ctx.buf.length - body;
    if (available < len) {
      throw new AxdrError(
        'LengthPastEnd',
        body,
        `declared length ${len} at offset ${body} runs past end (${available} available)`,
      );
    }
    ctx.spans.push({ start: body, end: body + len, kind: 'payload', label: name, depth });
    const bytes = ctx.buf.slice(body, body + len);
    return { node: { tag: raw, name, offset: pos, repr: stringRepr(raw, bytes) }, next: body + len };
  }

  // Bit-string: length is in BITS, payload rounds up to whole bytes.
  if (raw === 4) {
    const { value: bits, consumed } = decodeLength(ctx, after, depth);
    ctx.maxDeclared = Math.max(ctx.maxDeclared, bits);
    const byteLen = Math.ceil(bits / 8);
    const body = after + consumed;
    const available = ctx.buf.length - body;
    if (available < byteLen) {
      throw new AxdrError(
        'LengthPastEnd',
        body,
        `declared length ${byteLen} at offset ${body} runs past end (${available} available)`,
      );
    }
    ctx.spans.push({ start: body, end: body + byteLen, kind: 'payload', label: 'bits', depth });
    return { node: { tag: raw, name, offset: pos, repr: `bit-string(${bits})` }, next: body + byteLen };
  }

  throw new AxdrError('UnknownTag', pos, `unsupported tag 0x${raw.toString(16)} at offset ${pos}`);
}

function scalarRepr(tag: number, b: Uint8Array): string {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  switch (tag) {
    case 3: return b[0] !== 0 ? 'true' : 'false';
    case 5: return String(dv.getInt32(0));
    case 6: return String(dv.getUint32(0));
    case 15: return String(dv.getInt8(0));
    case 16: return String(dv.getInt16(0));
    case 17: return String(dv.getUint8(0));
    case 18: return String(dv.getUint16(0));
    case 20: return String(dv.getBigInt64(0));
    case 21: return String(dv.getBigUint64(0));
    case 22: return `enum ${b[0]}`;
    case 23: return String(dv.getFloat32(0));
    case 24: return String(dv.getFloat64(0));
    case 13: return `bcd ${b[0]}`;
    default: return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  }
}

function stringRepr(tag: number, b: Uint8Array): string {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  if (tag === 10 || tag === 12) {
    const txt = new TextDecoder().decode(b);
    // Only show it as text when it actually is printable.
    if (/^[\x20-\x7e]*$/.test(txt)) return `"${txt}"`;
  }
  return hex.length > 0 ? hex : '(empty)';
}

/** Decode a complete buffer. Trailing bytes are an error, not a shrug. */
export function decode(buf: Uint8Array): DecodeResult {
  const ctx: Ctx = { buf, spans: [], maxDepth: 0, maxDeclared: 0 };
  try {
    const { node, next } = decodeValue(ctx, 0, 0);
    if (next !== buf.length) {
      throw new AxdrError(
        'TrailingBytes',
        next,
        `trailing bytes: ${buf.length - next} left at offset ${next}`,
      );
    }
    return { ok: true, root: node, spans: ctx.spans, maxDepth: ctx.maxDepth, maxDeclared: ctx.maxDeclared };
  } catch (e) {
    if (e instanceof AxdrError) {
      ctx.spans.push({ start: e.offset, end: e.offset + 1, kind: 'error', label: e.kind, depth: 0 });
      return {
        ok: false,
        kind: e.kind,
        message: e.message,
        offset: e.offset,
        spans: ctx.spans,
        maxDepth: ctx.maxDepth,
        maxDeclared: ctx.maxDeclared,
      };
    }
    // A RangeError here means the recursion guard failed to hold — which is
    // exactly the bug the guard exists to prevent, so surface it honestly.
    return {
      ok: false,
      kind: 'StackOverflow',
      message: 'native stack exhausted — the depth guard did not hold',
      offset: 0,
      spans: ctx.spans,
      maxDepth: ctx.maxDepth,
      maxDeclared: ctx.maxDeclared,
    };
  }
}

export const hex = (s: string): Uint8Array =>
  new Uint8Array(
    (s.replace(/[^0-9a-fA-F]/g, '').match(/../g) ?? []).map((h) => parseInt(h, 16)),
  );

export interface Sample {
  id: string;
  name: string;
  blurb: string;
  bytes: Uint8Array;
  /** What a naive decoder does with this input. */
  naive: string;
}

/** n nested single-element arrays wrapping a uint8. */
function nest(n: number): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(0x01, 0x01);
  out.push(0x11, 0x2a);
  return new Uint8Array(out);
}

export const SAMPLES: Sample[] = [
  {
    id: 'valid',
    name: 'Well-formed',
    blurb: 'A structure of three values: a uint16, an octet-string, and an enum. This is what an honest frame looks like.',
    bytes: hex('02 03 12 04 d2 09 04 de ad be ef 16 01'),
    naive: 'decodes correctly',
  },
  {
    id: 'alloc',
    name: 'Allocation bomb',
    blurb: 'Six bytes. The array header declares 4,294,967,295 elements and then simply stops. A decoder that trusts the count reserves 4 billion slots before reading a single element.',
    bytes: hex('01 84 ff ff ff ff'),
    naive: 'reserves ~4 billion elements, OOM',
  },
  {
    id: 'depth',
    name: 'Depth bomb',
    blurb: '40 nested single-element arrays. Each level costs a stack frame in a recursive decoder, and nothing in the format stops you at 40 — or at 40,000.',
    bytes: nest(40),
    naive: 'recurses until the stack is gone',
  },
  {
    id: 'pastend',
    name: 'Length past end',
    blurb: 'An octet-string that declares 200 bytes of payload and supplies four. The classic over-read: trust the declared length and you are reading whatever sits after the buffer.',
    bytes: hex('09 81 c8 de ad be ef'),
    naive: 'reads 200 bytes past the buffer',
  },
  {
    id: 'overflow',
    name: 'Length overflow',
    blurb: 'A long-form length claiming eight bytes of length, all 0xFF. Accumulate that without checking and the value wraps to something small and plausible.',
    bytes: hex('09 88 ff ff ff ff ff ff ff ff 00'),
    naive: 'integer wraps; length becomes small and wrong',
  },
  {
    id: 'trailing',
    name: 'Trailing bytes',
    blurb: 'A valid uint16 followed by two bytes nobody asked for. Harmless-looking, which is the problem: it usually means you disagree with the sender about the frame.',
    bytes: hex('12 04 d2 ff ff'),
    naive: 'silently ignores the extra bytes',
  },
];
