import { describe, it, expect } from 'vitest';
import {
  encodeRows, toPgMicros, hasNulInText, SIGNATURE,
  PG_EPOCH_DAYS_FROM_UNIX, type Value,
} from '../src/scripts/copybinary';

const NUL = String.fromCharCode(0);
const bytesOf = (rows: Value[][], opts = {}) =>
  Array.from(encodeRows(['a', 'b', 'c', 'd', 'e'], rows, opts).bytes);

// These mirror the Rust encoder's own unit tests, assertion for assertion.
describe('COPY BINARY wire format', () => {
  it('an empty stream is exactly 21 bytes', () => {
    const b = bytesOf([]);
    expect(b).toHaveLength(21);
    expect(b.slice(0, 11)).toEqual(SIGNATURE);
    expect(b.slice(11, 15)).toEqual([0, 0, 0, 0]);   // flags
    expect(b.slice(15, 19)).toEqual([0, 0, 0, 0]);   // header extension length
    expect(b.slice(19, 21)).toEqual([0xff, 0xff]);   // trailer, int16 -1
  });

  it('encodes NULL as length -1 with no data', () => {
    const b = bytesOf([[{ kind: 'null' }]], { includeHeader: false, includeTrailer: false });
    expect(b).toEqual([0x00, 0x01, 0xff, 0xff, 0xff, 0xff]);
  });

  it('encodes bool as one byte', () => {
    const t = bytesOf([[{ kind: 'bool', v: true }]], { includeHeader: false, includeTrailer: false });
    expect(t.slice(2)).toEqual([0x00, 0x00, 0x00, 0x01, 0x01]);
    const f = bytesOf([[{ kind: 'bool', v: false }]], { includeHeader: false, includeTrailer: false });
    expect(f.slice(2)).toEqual([0x00, 0x00, 0x00, 0x01, 0x00]);
  });

  it('encodes int2 big-endian, including negatives', () => {
    const p = bytesOf([[{ kind: 'int2', v: 0x1234 }]], { includeHeader: false, includeTrailer: false });
    expect(p.slice(2)).toEqual([0x00, 0x00, 0x00, 0x02, 0x12, 0x34]);
    const n = bytesOf([[{ kind: 'int2', v: -1 }]], { includeHeader: false, includeTrailer: false });
    expect(n.slice(2)).toEqual([0x00, 0x00, 0x00, 0x02, 0xff, 0xff]);
  });

  it('encodes int4 and int8 big-endian', () => {
    const i4 = bytesOf([[{ kind: 'int4', v: 0x12345678 }]], { includeHeader: false, includeTrailer: false });
    expect(i4.slice(2)).toEqual([0x00, 0x00, 0x00, 0x04, 0x12, 0x34, 0x56, 0x78]);
    const i8 = bytesOf([[{ kind: 'int8', v: 0x0102030405060708n }]], { includeHeader: false, includeTrailer: false });
    expect(i8.slice(2)).toEqual([
      0x00, 0x00, 0x00, 0x08,
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    ]);
  });

  it('writes the tuple field count before the fields', () => {
    const b = bytesOf([[{ kind: 'bool', v: true }, { kind: 'null' }]], {
      includeHeader: false, includeTrailer: false,
    });
    expect(b.slice(0, 2)).toEqual([0x00, 0x02]);
  });

  it('measures text in bytes, not characters', () => {
    // "é" is two bytes in UTF-8.
    const b = bytesOf([[{ kind: 'text', v: 'é' }]], { includeHeader: false, includeTrailer: false });
    expect(b.slice(2, 6)).toEqual([0x00, 0x00, 0x00, 0x02]);
  });

  it('strips NUL from text, because 22021 aborts the whole COPY', () => {
    const rows: Value[][] = [[{ kind: 'text', v: `AB${NUL}CD` }]];
    const enc = encodeRows(['a'], rows, { includeHeader: false, includeTrailer: false, stripNul: true });
    expect(enc.strippedNul).toBe(true);
    expect(Array.from(enc.bytes).slice(2, 6)).toEqual([0x00, 0x00, 0x00, 0x04]);
    // The payload must carry no NUL at all — that is the entire point.
    expect(Array.from(enc.bytes).slice(6)).not.toContain(0x00);
    expect(Array.from(enc.bytes).slice(6)).toEqual([0x41, 0x42, 0x43, 0x44]);
  });

  it('leaves the NUL in place when stripping is disabled — the bug, reproduced', () => {
    const rows: Value[][] = [[{ kind: 'text', v: `AB${NUL}CD` }]];
    const enc = encodeRows(['a'], rows, { includeHeader: false, includeTrailer: false, stripNul: false });
    expect(enc.strippedNul).toBe(false);
    expect(Array.from(enc.bytes).slice(6)).toEqual([0x41, 0x42, 0x00, 0x43, 0x44]);
    expect(hasNulInText(rows)).toBe(true);
  });

  it('costs nothing for text without a NUL', () => {
    const rows: Value[][] = [[{ kind: 'text', v: 'ordinary' }]];
    expect(encodeRows(['a'], rows).strippedNul).toBe(false);
    expect(hasNulInText(rows)).toBe(false);
  });

  it('counts timestamps from 2000-01-01, not the Unix epoch', () => {
    expect(PG_EPOCH_DAYS_FROM_UNIX).toBe(10_957);
    // The postgres epoch itself is zero.
    expect(toPgMicros(Date.UTC(2000, 0, 1))).toBe(0);
    // The Unix epoch is thirty years negative.
    expect(toPgMicros(0)).toBe(-946_684_800_000_000);
    // One second past the postgres epoch.
    expect(toPgMicros(Date.UTC(2000, 0, 1) + 1000)).toBe(1_000_000);
  });

  it('produces spans covering every byte exactly once', () => {
    const enc = encodeRows(['a', 'b'], [[{ kind: 'int2', v: 7 }, { kind: 'text', v: 'hi' }]]);
    const seen = new Array(enc.bytes.length).fill(0);
    for (const s of enc.spans) for (let i = s.start; i < s.end; i++) seen[i]++;
    expect(seen.every((c) => c === 1)).toBe(true);
  });
});
