import { describe, it, expect } from 'vitest';
import {
  buildDirentBuffer, walk, statsRequired, D_NAME_OFFSET, DT_REG, DT_DIR, DT_UNKNOWN,
} from '../src/scripts/dirent';

const buf = buildDirentBuffer();

describe('dirent64 buffer', () => {
  it('covers every byte of every entry exactly once — no gaps, no overlaps', () => {
    for (const e of buf.entries) {
      const seen = new Array(e.reclen).fill(0);
      for (const f of e.fields) {
        for (let i = f.offset - e.offset; i < f.offset - e.offset + f.length; i++) seen[i]++;
      }
      expect(seen.every((c) => c === 1), `entry ${e.name}`).toBe(true);
    }
  });

  it('lays entries end to end with d_reclen as the stride', () => {
    let at = 0;
    for (const e of buf.entries) {
      expect(e.offset).toBe(at);
      at += e.reclen;
    }
    expect(at).toBe(buf.bytes.length);
  });

  it('keeps every entry 8-byte aligned', () => {
    for (const e of buf.entries) {
      expect(e.offset % 8).toBe(0);
      expect(e.reclen % 8).toBe(0);
    }
  });

  it('puts d_name at offset 19 and NUL-terminates it', () => {
    for (const e of buf.entries) {
      const nameField = e.fields.find((f) => f.role === 'name')!;
      expect(nameField.offset - e.offset).toBe(D_NAME_OFFSET);
      expect(buf.bytes[nameField.offset + nameField.length - 1]).toBe(0);
    }
  });

  it('round-trips: walking the raw bytes recovers the original names', () => {
    const names = walk(buf).map((x) => x.name);
    expect(names).toEqual(buf.entries.map((e) => e.name));
  });

  it('preserves d_type through the walk', () => {
    const walked = walk(buf);
    expect(walked.find((w) => w.name === 'push_0001.hex')!.dType).toBe(DT_REG);
    expect(walked.find((w) => w.name === '..')!.dType).toBe(DT_DIR);
    expect(walked.find((w) => w.name === 'push_0002.hex')!.dType).toBe(DT_UNKNOWN);
  });

  it('needs a stat only for DT_UNKNOWN', () => {
    expect(statsRequired(buf)).toBe(1);
    const allKnown = buildDirentBuffer([
      { name: 'a.hex', dType: DT_REG, ino: 1 },
      { name: 'b.hex', dType: DT_REG, ino: 2 },
    ]);
    expect(statsRequired(allKnown)).toBe(0);
  });

  it('stops cleanly on a truncated buffer rather than running off the end', () => {
    const cut = { bytes: buf.bytes.slice(0, buf.entries[0].reclen + 4), entries: buf.entries };
    expect(() => walk(cut)).not.toThrow();
    expect(walk(cut).length).toBe(1);
  });

  it('handles a long name without breaking alignment', () => {
    const long = buildDirentBuffer([{ name: 'x'.repeat(97), dType: DT_REG, ino: 9 }]);
    expect(long.entries[0].reclen % 8).toBe(0);
    expect(walk(long)[0].name).toHaveLength(97);
  });
});
