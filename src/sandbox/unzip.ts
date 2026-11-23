import { lstatSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { FactoryError } from '../platform/errors.js';

export interface UnzipOptions {
  /** The zip file to read. */
  zipPath: string;
  /** The folder every entry must stay strictly under. Created when missing. */
  destRoot: string;
}

/** Total uncompressed size one archive may declare. The sample is far below this; it only stops zip bombs. */
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const UNIX_HOST = 3;

interface Entry {
  /** The name as written in the archive. */
  name: string;
  /** Path parts under the destination root, without the trailing "/". */
  parts: string[];
  isDir: boolean;
  /** File mode bits to write (folders and files get fixed modes; only the executable bit is kept). */
  mode: number;
  data: Buffer;
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

const unsafe = (message: string, where: string, next: string, code = 'zip_unsafe'): FactoryError =>
  new FactoryError({ code, message, where, next, exitCode: 2 });

const REPLACE_ZIP = 'Use a zip that holds only regular files and folders under one root. Do not extract this one.';

function entryProblem(name: string): string | undefined {
  if (name === '') return 'has an empty name';
  if (name.includes('\0')) return 'has a NUL byte in its name';
  if (name.includes('\\')) return 'has a backslash in its name';
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return 'has an absolute path';
  if (name.split('/').includes('..')) return 'leaves the destination with ".."';
  return undefined;
}

/** The raw bytes of an entry, inflated and checked against the central directory (size and CRC). */
interface RawEntry {
  name: string;
  method: number;
  flags: number;
  size: number;
  compressed: number;
  crc: number;
  offset: number;
}

function readData(bytes: Buffer, raw: RawEntry): Buffer {
  const { name, method, flags, size, compressed, crc, offset } = raw;
  const bad = (why: string): FactoryError => unsafe(`Zip entry ${name} ${why}.`, name, REPLACE_ZIP);
  if (flags & 1) throw bad('is encrypted');
  if (offset + 30 > bytes.length || bytes.readUInt32LE(offset) !== LOCAL_SIGNATURE) throw bad('has no local header');
  const nameLength = bytes.readUInt16LE(offset + 26);
  const extraLength = bytes.readUInt16LE(offset + 28);
  const localName = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
  if (localName !== name) throw bad('has a local header that does not match the central directory');
  const start = offset + 30 + nameLength + extraLength;
  if (start + compressed > bytes.length) throw bad('runs past the end of the file');
  const stored = bytes.subarray(start, start + compressed);

  let data: Buffer;
  if (method === 0) {
    data = stored;
  } else if (method === 8) {
    try {
      data = inflateRawSync(stored, { maxOutputLength: Math.max(size, 1) });
    } catch {
      throw bad('does not inflate to its declared size');
    }
  } else {
    throw bad(`uses compression method ${method}, which is not supported`);
  }
  if (data.length !== size) throw bad('does not have its declared size');
  if (crc32(data) !== crc) throw bad('fails its CRC check');
  return data;
}

/** Reads and validates the whole archive. Nothing is written here. */
function readEntries(zipPath: string): Entry[] {
  const bytes = readFileSync(zipPath);
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== EOCD_SIGNATURE) end -= 1;
  if (end < 0) {
    throw unsafe(`${zipPath} is not a zip file.`, zipPath, REPLACE_ZIP, 'zip_invalid');
  }
  const count = bytes.readUInt16LE(end + 10);
  let cursor = bytes.readUInt32LE(end + 16);

  const entries: Entry[] = [];
  const kinds = new Map<string, 'file' | 'dir'>();
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw unsafe(`${zipPath} has a damaged central directory.`, zipPath, REPLACE_ZIP, 'zip_invalid');
    }
    const madeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const size = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38);
    const offset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    const problem = entryProblem(name);
    if (problem !== undefined) {
      throw unsafe(`Zip entry ${name} ${problem}.`, name, REPLACE_ZIP);
    }
    // Only regular files and folders. A symlink, device, fifo or socket entry has another file type in the mode.
    const mode = madeBy >>> 8 === UNIX_HOST ? attributes >>> 16 : 0;
    const type = mode & S_IFMT;
    const isDir = name.endsWith('/');
    if (type !== 0 && type !== (isDir ? S_IFDIR : S_IFREG)) {
      throw unsafe(`Zip entry ${name} is not a regular file or folder (links are not extracted).`, name, REPLACE_ZIP);
    }

    const parts = (isDir ? name.slice(0, -1) : name).split('/');
    if (parts.some((part) => part === '' || part === '.')) {
      throw unsafe(`Zip entry ${name} has an empty or "." segment.`, name, REPLACE_ZIP);
    }
    // No repeated names, and no file used as a folder (or the reverse): that is how a later entry would reuse a path.
    const key = parts.join('/');
    for (let depth = 1; depth < parts.length; depth += 1) {
      if (kinds.get(parts.slice(0, depth).join('/')) === 'file') {
        throw unsafe(`Zip entry ${name} sits under a file.`, name, REPLACE_ZIP);
      }
    }
    const seen = kinds.get(key);
    if (seen !== undefined && (!isDir || seen === 'file')) {
      throw unsafe(`Zip entry ${name} appears twice.`, name, REPLACE_ZIP);
    }
    kinds.set(key, isDir ? 'dir' : 'file');

    total += size;
    if (total > MAX_TOTAL_BYTES) {
      throw unsafe(`${zipPath} declares more than ${MAX_TOTAL_BYTES} bytes.`, name, REPLACE_ZIP);
    }
    const data = isDir ? Buffer.alloc(0) : readData(bytes, { name, method, flags, size, compressed, crc, offset });
    entries.push({ name, parts, isDir, mode: mode & 0o111 ? 0o755 : 0o644, data });
  }
  return entries;
}

const linkRefusal = (path: string): FactoryError =>
  unsafe(
    `${path} is a symbolic link. Unzip does not follow links out of the destination root.`,
    path,
    'Remove the link, or choose a destination whose folders are real folders.',
    'sandbox_symlink',
  );

/** Creates `parts` under `root` one folder at a time, refusing a link or a non-folder at any step. */
function ensureFolder(root: string, parts: readonly string[]): string {
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      mkdirSync(current);
      continue;
    }
    if (stat.isSymbolicLink()) throw linkRefusal(current);
    if (!stat.isDirectory()) {
      throw unsafe(`${current} exists and is not a folder.`, current, 'Remove it, then unpack again.');
    }
  }
  return current;
}

/**
 * Extracts a zip under `destRoot`. Every entry is checked, and its data inflated and verified, before the first
 * file is written. Refuses (FactoryError, exit 2) absolute paths, `..`, backslashes, symlinks and any other
 * entry that is not a regular file or folder, and a `destRoot` that is a symlink. Entries are written with
 * fixed modes (0644, or 0755 for an executable file).
 */
export function unzipSafely(options: UnzipOptions): void {
  const root = resolve(options.destRoot);
  try {
    if (lstatSync(root).isSymbolicLink()) throw linkRefusal(root);
  } catch (error) {
    if (error instanceof FactoryError) throw error;
    // The destination does not exist yet; it is created below.
  }

  const entries = readEntries(options.zipPath);

  mkdirSync(root, { recursive: true });
  for (const entry of entries) {
    if (entry.isDir) {
      ensureFolder(root, entry.parts);
      continue;
    }
    const folder = ensureFolder(root, entry.parts.slice(0, -1));
    const target = join(folder, entry.parts[entry.parts.length - 1] as string);
    try {
      if (lstatSync(target).isSymbolicLink()) throw linkRefusal(target);
    } catch (error) {
      if (error instanceof FactoryError) throw error;
    }
    writeFileSync(target, entry.data, { mode: entry.mode });
  }
}
