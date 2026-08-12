import { describe, it, expect } from 'vitest';
import { decode, hex, SAMPLES, MAX_DEPTH } from '../src/scripts/axdr';

const kindOf = (bytes: Uint8Array) => {
  const r = decode(bytes);
  return r.ok ? 'ok' : r.kind;
};

describe('A-XDR decoder guards', () => {
  it('decodes a well-formed structure', () => {
    const r = decode(hex('02 03 12 04 d2 09 04 de ad be ef 16 01'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.name).toBe('structure');
    expect(r.root.children).toHaveLength(3);
    expect(r.root.children![0].repr).toBe('1234');
  });

  it('survives an allocation bomb instead of reserving for it', () => {
    // Header declares 4,294,967,295 elements in five total bytes.
    const r = decode(hex('01 84 ff ff ff ff'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('UnexpectedEof');
    // The point: it reports the declared count without ever allocating for it.
    expect(r.maxDeclared).toBe(4294967295);
  });

  it('stops a depth bomb at the guard, not at the stack limit', () => {
    const deep: number[] = [];
    for (let i = 0; i < 40; i++) deep.push(0x01, 0x01);
    deep.push(0x11, 0x2a);
    const r = decode(new Uint8Array(deep));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('DepthExceeded');
    expect(r.maxDepth).toBeLessThanOrEqual(MAX_DEPTH + 1);
  });

  it('accepts nesting right up to the ceiling', () => {
    const deep: number[] = [];
    for (let i = 0; i < MAX_DEPTH - 1; i++) deep.push(0x01, 0x01);
    deep.push(0x11, 0x2a);
    expect(decode(new Uint8Array(deep)).ok).toBe(true);
  });

  it('rejects a declared length that runs past the end', () => {
    expect(kindOf(hex('09 81 c8 de ad be ef'))).toBe('LengthPastEnd');
  });

  it('rejects a length field that overflows the safe integer range', () => {
    expect(kindOf(hex('09 88 ff ff ff ff ff ff ff ff 00'))).toBe('LengthOverflow');
  });

  it('rejects a zero-width long-form length', () => {
    expect(kindOf(hex('09 80 00'))).toBe('InvalidLength');
  });

  it('rejects trailing bytes rather than ignoring them', () => {
    expect(kindOf(hex('12 04 d2 ff ff'))).toBe('TrailingBytes');
  });

  it('rejects an unknown tag', () => {
    expect(kindOf(hex('fe 00'))).toBe('UnknownTag');
  });

  it('reports a byte offset on every failure', () => {
    for (const s of SAMPLES) {
      const r = decode(s.bytes);
      if (r.ok) continue;
      expect(Number.isInteger(r.offset)).toBe(true);
      expect(r.offset).toBeGreaterThanOrEqual(0);
      expect(r.offset).toBeLessThanOrEqual(s.bytes.length);
    }
  });

  it('never throws, whatever it is handed', () => {
    for (let i = 0; i < 3000; i++) {
      const len = i % 24;
      const b = new Uint8Array(len);
      for (let k = 0; k < len; k++) b[k] = (i * 31 + k * 17) & 0xff;
      expect(() => decode(b)).not.toThrow();
    }
  });

  it('every shipped sample behaves as the post claims', () => {
    expect(kindOf(SAMPLES.find((s) => s.id === 'valid')!.bytes)).toBe('ok');
    expect(kindOf(SAMPLES.find((s) => s.id === 'alloc')!.bytes)).toBe('UnexpectedEof');
    expect(kindOf(SAMPLES.find((s) => s.id === 'depth')!.bytes)).toBe('DepthExceeded');
    expect(kindOf(SAMPLES.find((s) => s.id === 'pastend')!.bytes)).toBe('LengthPastEnd');
    expect(kindOf(SAMPLES.find((s) => s.id === 'overflow')!.bytes)).toBe('LengthOverflow');
    expect(kindOf(SAMPLES.find((s) => s.id === 'trailing')!.bytes)).toBe('TrailingBytes');
  });
});
