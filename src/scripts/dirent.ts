/** A real `struct linux_dirent64` buffer, built byte-for-byte, plus the field
 *  map the figure walks.
 *
 *  Layout on x86-64 (little-endian):
 *    off  0  d_ino     u64
 *    off  8  d_off     i64
 *    off 16  d_reclen  u16   ← the stride; entries are variable-length
 *    off 18  d_type    u8
 *    off 19  d_name    NUL-terminated, then padding to an 8-byte boundary
 */

export const DT_UNKNOWN = 0;
export const DT_DIR = 4;
export const DT_REG = 8;

export const D_NAME_OFFSET = 19;

export interface Field {
  name: string;
  offset: number;
  length: number;
  role: 'ino' | 'off' | 'reclen' | 'type' | 'name' | 'pad';
  value: string;
  note: string;
}

export interface Entry {
  name: string;
  dType: number;
  offset: number;
  reclen: number;
  fields: Field[];
}

export interface DirentBuffer {
  bytes: Uint8Array;
  entries: Entry[];
}

const align8 = (n: number) => (n + 7) & ~7;

const typeName = (t: number) =>
  t === DT_REG ? 'DT_REG' : t === DT_DIR ? 'DT_DIR' : t === DT_UNKNOWN ? 'DT_UNKNOWN' : `type ${t}`;

const typeNote = (t: number) =>
  t === DT_REG
    ? 'a regular file — usable directly, no stat needed'
    : t === DT_DIR
      ? 'a directory — skipped by the scanner'
      : 'the filesystem would not say; this is the one case that costs a stat';

interface Spec {
  name: string;
  dType: number;
  ino: number;
}

const SPECS: Spec[] = [
  { name: '.', dType: DT_DIR, ino: 262145 },
  { name: '..', dType: DT_DIR, ino: 262144 },
  { name: 'push_0001.hex', dType: DT_REG, ino: 262301 },
  { name: 'staging', dType: DT_DIR, ino: 262402 },
  { name: 'push_0002.hex', dType: DT_UNKNOWN, ino: 262303 },
];

export function buildDirentBuffer(specs: Spec[] = SPECS): DirentBuffer {
  // Two passes: size everything, then fill, so d_off can point at the next entry.
  const reclens = specs.map((s) => align8(D_NAME_OFFSET + s.name.length + 1));
  const total = reclens.reduce((a, b) => a + b, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  const entries: Entry[] = [];

  let at = 0;
  specs.forEach((spec, i) => {
    const reclen = reclens[i];
    const nameBytes = new TextEncoder().encode(spec.name);
    // d_off is an opaque cookie for seeking; the kernel uses the offset of the
    // *next* entry. Nothing should interpret it beyond handing it back.
    const dOff = at + reclen;

    view.setBigUint64(at + 0, BigInt(spec.ino), true);
    view.setBigInt64(at + 8, BigInt(dOff), true);
    view.setUint16(at + 16, reclen, true);
    bytes[at + 18] = spec.dType;
    bytes.set(nameBytes, at + D_NAME_OFFSET);
    // Remaining bytes are already zero: the NUL terminator plus padding.

    const nameFieldLen = nameBytes.length + 1; // include the terminator
    const padLen = reclen - D_NAME_OFFSET - nameFieldLen;

    const fields: Field[] = [
      {
        name: 'd_ino', offset: at, length: 8, role: 'ino',
        value: String(spec.ino),
        note: 'inode number — unique per file on this filesystem',
      },
      {
        name: 'd_off', offset: at + 8, length: 8, role: 'off',
        value: String(dOff),
        note: 'opaque seek cookie. Do not do arithmetic on it; hand it back untouched',
      },
      {
        name: 'd_reclen', offset: at + 16, length: 2, role: 'reclen',
        value: String(reclen),
        note: 'THE stride. Entries are variable-length; this is how you find the next one',
      },
      {
        name: 'd_type', offset: at + 18, length: 1, role: 'type',
        value: typeName(spec.dType),
        note: typeNote(spec.dType),
      },
      {
        name: 'd_name', offset: at + D_NAME_OFFSET, length: nameFieldLen, role: 'name',
        value: `"${spec.name}" + NUL`,
        note: 'NUL-terminated, not length-prefixed — you scan for the zero',
      },
    ];
    if (padLen > 0) {
      fields.push({
        name: '(padding)', offset: at + D_NAME_OFFSET + nameFieldLen, length: padLen, role: 'pad',
        value: `${padLen} byte${padLen === 1 ? '' : 's'}`,
        note: 'zero padding so the next entry starts 8-byte aligned',
      });
    }

    entries.push({ name: spec.name, dType: spec.dType, offset: at, reclen, fields });
    at += reclen;
  });

  return { bytes, entries };
}

/** Walk the buffer exactly as the scanner does: read d_reclen, scan d_name for
 *  a NUL, advance by the stride. Returns the names in order. */
export function walk(buf: DirentBuffer): { name: string; dType: number }[] {
  const { bytes } = buf;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: { name: string; dType: number }[] = [];
  let pos = 0;

  while (pos < bytes.length) {
    // The header must be fully present before any of it is read. A short final
    // record is normal — the kernel fills whole entries only, but a truncated
    // or hand-made buffer will not.
    if (pos + D_NAME_OFFSET > bytes.length) break;
    const reclen = view.getUint16(pos + 16, true);
    if (reclen < D_NAME_OFFSET + 1 || pos + reclen > bytes.length) break;
    const dType = bytes[pos + 18];
    const start = pos + D_NAME_OFFSET;
    let end = start;
    while (end < pos + reclen && bytes[end] !== 0) end++;
    out.push({ name: new TextDecoder().decode(bytes.subarray(start, end)), dType });
    pos += reclen;
  }

  return out;
}

/** How many stat() calls a scanner needs for this buffer. DT_UNKNOWN is the
 *  only case that forces one. */
export function statsRequired(buf: DirentBuffer): number {
  return buf.entries.filter((e) => e.dType === DT_UNKNOWN).length;
}
