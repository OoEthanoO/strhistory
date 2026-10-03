// Minimal ZIP reader (stored or deflated entries, no ZIP64) built on node:zlib, so
// the pipeline does not depend on a zip package. Enough for the pinned
// Cliopatria archive (one ~165 MB GeoJSON member).
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) throw new Error('unexpected end of zip file');
    done += n;
  }
  return buf;
}

/** Lists the entries of a zip file: [{ name, method, compressedSize, size, localOffset }]. */
export function listZip(file) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    // The end-of-central-directory record sits in the last 22 + up to 65535 (comment) bytes.
    const tailLen = Math.min(size, 22 + 0xffff);
    const tail = readAt(fd, size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error(`${file}: not a zip file (no end-of-central-directory record)`);
    const count = tail.readUInt16LE(eocd + 10);
    const cenSize = tail.readUInt32LE(eocd + 12);
    const cenOffset = tail.readUInt32LE(eocd + 16);
    if (cenOffset === 0xffffffff || count === 0xffff) throw new Error(`${file}: ZIP64 archives are not supported`);
    const cen = readAt(fd, cenOffset, cenSize);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cen.readUInt32LE(p) !== CEN_SIG) throw new Error(`${file}: corrupt central directory`);
      const method = cen.readUInt16LE(p + 10);
      const compressedSize = cen.readUInt32LE(p + 20);
      const uncompressed = cen.readUInt32LE(p + 24);
      const nameLen = cen.readUInt16LE(p + 28);
      const extraLen = cen.readUInt16LE(p + 30);
      const commentLen = cen.readUInt16LE(p + 32);
      const localOffset = cen.readUInt32LE(p + 42);
      const name = cen.toString('utf8', p + 46, p + 46 + nameLen);
      entries.push({ name, method, compressedSize, size: uncompressed, localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  } finally {
    closeSync(fd);
  }
}

/** Returns the uncompressed bytes of the first entry whose name matches `predicate`. */
export function readZipEntry(file, predicate) {
  const entry = listZip(file).find((e) => predicate(e.name));
  if (!entry) throw new Error(`${file}: no matching entry`);
  const fd = openSync(file, 'r');
  try {
    const loc = readAt(fd, entry.localOffset, 30);
    if (loc.readUInt32LE(0) !== LOC_SIG) throw new Error(`${file}: corrupt local header for ${entry.name}`);
    const dataStart = entry.localOffset + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
    const raw = readAt(fd, dataStart, entry.compressedSize);
    let out;
    if (entry.method === 0) out = raw;
    else if (entry.method === 8) out = inflateRawSync(raw);
    else throw new Error(`${file}: unsupported compression method ${entry.method} for ${entry.name}`);
    if (out.length !== entry.size) throw new Error(`${file}: ${entry.name} inflated to ${out.length} bytes, expected ${entry.size}`);
    return out;
  } finally {
    closeSync(fd);
  }
}
