/** PostgreSQL COPY BINARY encoder — a port of the real one, faithful enough
 *  that it satisfies the same assertions as the Rust unit tests.
 *
 *  Stream shape:
 *    header : 11-byte signature "PGCOPY\n\xff\r\n\0" + int32 flags + int32 ext len
 *    tuple  : int16 field count, then per field int32 length (-1 = NULL) + bytes
 *    trailer: int16 -1
 *  Everything is big-endian. */

export const SIGNATURE = [0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00];

/** Days from the Unix epoch to the PostgreSQL epoch (2000-01-01). */
export const PG_EPOCH_DAYS_FROM_UNIX = 10_957;
export const PG_EPOCH_SECS_FROM_UNIX = PG_EPOCH_DAYS_FROM_UNIX * 86_400;

export type PgType = 'bool' | 'int2' | 'int4' | 'int8' | 'float8' | 'text' | 'timestamptz';

export type Value =
  | { kind: 'null' }
  | { kind: 'bool'; v: boolean }
  | { kind: 'int2'; v: number }
  | { kind: 'int4'; v: number }
  | { kind: 'int8'; v: bigint }
  | { kind: 'float8'; v: number }
  | { kind: 'text'; v: string }
  | { kind: 'timestamptz'; unixMs: number };

export type SpanRole = 'sig' | 'flags' | 'ext' | 'count' | 'len' | 'data' | 'trailer';

export interface Span {
  start: number;
  end: number;
  role: SpanRole;
  label: string;
  detail: string;
}

export interface Encoded {
  bytes: Uint8Array;
  spans: Span[];
  /** True when a NUL byte was found in text and removed. */
  strippedNul: boolean;
}

export class Writer {
  bytes: number[] = [];
  spans: Span[] = [];

  private mark(role: SpanRole, label: string, detail: string, from: number) {
    this.spans.push({ start: from, end: this.bytes.length, role, label, detail });
  }

  raw(bs: number[], role: SpanRole, label: string, detail: string) {
    const from = this.bytes.length;
    this.bytes.push(...bs);
    this.mark(role, label, detail, from);
  }

  i16(v: number, role: SpanRole, label: string, detail: string) {
    const from = this.bytes.length;
    const u = v < 0 ? v + 0x10000 : v;
    this.bytes.push((u >> 8) & 0xff, u & 0xff);
    this.mark(role, label, detail, from);
  }

  i32(v: number, role: SpanRole, label: string, detail: string) {
    const from = this.bytes.length;
    const u = v < 0 ? v + 0x100000000 : v;
    this.bytes.push((u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff);
    this.mark(role, label, detail, from);
  }
}

function bigintBE(v: bigint): number[] {
  const out: number[] = [];
  let u = v < 0n ? v + (1n << 64n) : v;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(u & 0xffn);
    u >>= 8n;
  }
  return out;
}

function f64BE(v: number): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, false);
  return Array.from(b);
}

/** Microseconds since 2000-01-01 UTC — NOT the Unix epoch. Getting this wrong
 *  shifts every timestamp by thirty years and Postgres accepts it happily. */
export function toPgMicros(unixMs: number): number {
  return Math.round(unixMs * 1000) - PG_EPOCH_SECS_FROM_UNIX * 1_000_000;
}

export function writeHeader(w: Writer): void {
  w.raw(SIGNATURE, 'sig', 'signature', 'PGCOPY\\n\\xff\\r\\n\\0 — 11 bytes identifying a binary COPY stream');
  w.i32(0, 'flags', 'flags', 'no OIDs, no extensions');
  w.i32(0, 'ext', 'ext length', 'header extension area, always zero in practice');
}

export function writeField(w: Writer, value: Value, column: string, stripNul: boolean): boolean {
  let stripped = false;

  switch (value.kind) {
    case 'null':
      w.i32(-1, 'len', `${column}: length`, '-1 means SQL NULL — no data bytes follow');
      return false;
    case 'bool':
      w.i32(1, 'len', `${column}: length`, 'bool is 1 byte');
      w.raw([value.v ? 1 : 0], 'data', `${column} = ${value.v}`, '0x01 true, 0x00 false');
      return false;
    case 'int2': {
      w.i32(2, 'len', `${column}: length`, 'int2 is exactly 2 bytes');
      const u = value.v < 0 ? value.v + 0x10000 : value.v;
      w.raw([(u >> 8) & 0xff, u & 0xff], 'data', `${column} = ${value.v}`, 'big-endian, signed');
      return false;
    }
    case 'int4': {
      w.i32(4, 'len', `${column}: length`, 'int4 is exactly 4 bytes');
      const u = value.v < 0 ? value.v + 0x100000000 : value.v;
      w.raw(
        [(u >>> 24) & 0xff, (u >>> 16) & 0xff, (u >>> 8) & 0xff, u & 0xff],
        'data', `${column} = ${value.v}`, 'big-endian, signed',
      );
      return false;
    }
    case 'int8':
      w.i32(8, 'len', `${column}: length`, 'int8 is exactly 8 bytes');
      w.raw(bigintBE(value.v), 'data', `${column} = ${value.v}`, 'big-endian, signed');
      return false;
    case 'float8':
      w.i32(8, 'len', `${column}: length`, 'float8 is 8 bytes');
      w.raw(f64BE(value.v), 'data', `${column} = ${value.v}`, 'IEEE 754 double, big-endian');
      return false;
    case 'timestamptz': {
      const micros = toPgMicros(value.unixMs);
      w.i32(8, 'len', `${column}: length`, 'timestamptz is 8 bytes');
      w.raw(
        bigintBE(BigInt(micros)), 'data', `${column} = ${micros} µs`,
        'microseconds since 2000-01-01, not the Unix epoch',
      );
      return false;
    }
    case 'text': {
      let bs = Array.from(new TextEncoder().encode(value.v));
      if (bs.includes(0)) {
        if (stripNul) {
          bs = bs.filter((b) => b !== 0);
          stripped = true;
        }
      }
      w.i32(bs.length, 'len', `${column}: length`, 'byte length, not character count');
      w.raw(
        bs, 'data', `${column} = ${JSON.stringify(value.v)}`,
        'raw UTF-8; the protocol takes the length from the field header, so no terminator',
      );
      return stripped;
    }
  }
}

export function encodeRows(
  columns: string[],
  rows: Value[][],
  opts: { stripNul?: boolean; includeHeader?: boolean; includeTrailer?: boolean } = {},
): Encoded {
  const { stripNul = true, includeHeader = true, includeTrailer = true } = opts;
  const w = new Writer();
  let strippedNul = false;

  if (includeHeader) writeHeader(w);

  for (const row of rows) {
    w.i16(row.length, 'count', 'field count', `${row.length} columns in this tuple`);
    row.forEach((v, i) => {
      if (writeField(w, v, columns[i] ?? `col${i}`, stripNul)) strippedNul = true;
    });
  }

  if (includeTrailer) w.i16(-1, 'trailer', 'trailer', 'field count of -1 ends the stream');

  return { bytes: new Uint8Array(w.bytes), spans: w.spans, strippedNul };
}

/** Does this row carry a NUL inside a text value? Postgres rejects those with
 *  SQLSTATE 22021 and aborts the entire COPY, not just the offending row. */
export function hasNulInText(rows: Value[][]): boolean {
  return rows.some((r) => r.some((v) => v.kind === 'text' && v.v.indexOf(String.fromCharCode(0)) !== -1));
}
