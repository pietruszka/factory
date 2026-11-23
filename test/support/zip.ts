import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Test-only zip reader and writer. It exists so tests can craft malicious archives in a temp folder and
 * list the entries of the committed fixture without going through the code under test.
 * Entries are stored (not compressed), which is all the tests need.
 */

export interface ZipEntry {
  /** The entry name exactly as written, for example `../evil.txt` or `/abs.txt`. */
  name: string;
  /** File content. A name ending in "/" is a folder entry and has no content. */
  data?: string;
  /** Makes the entry a symlink whose target is this text (unix mode 120777 in the external attributes). */
  symlinkTo?: string;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The bytes of a zip holding `entries`, in the given order. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.from(entry.symlinkTo ?? entry.data ?? '', 'utf8');
    const crc = crc32(content);
    const mode = entry.symlinkTo !== undefined ? 0o120777 : entry.name.endsWith('/') ? 0o040755 : 0o100644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(33, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by unix, version 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(((mode << 16) >>> 0), 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + content.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

/** Writes a crafted zip to `path`. */
export function writeZip(path: string, entries: ZipEntry[]): void {
  writeFileSync(path, buildZip(entries));
}

/** Entry names from the central directory of the zip at `path`, in archive order. */
export function listZipEntries(path: string): string[] {
  const bytes = readFileSync(path);
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) {
    end -= 1;
  }
  if (end < 0) {
    throw new Error(`${path} is not a zip: no end-of-central-directory record`);
  }
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    names.push(bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}
