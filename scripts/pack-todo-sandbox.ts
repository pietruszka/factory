/**
 * Dev-only: `npm run sandbox:pack` rebuilds the to-do sample fixture from its inputs in
 * `scripts/sandbox/todo-app/` (base = todo-v0, v1 and v2 = files that replace the earlier ones).
 * It builds a git repo with a fixed identity and fixed dates, tags it todo-v0, todo-v1 and todo-v2,
 * and writes `todo-app.zip` and `todo-app.manifest.json` next to each other (default: test/fixtures/sandbox).
 * It never installs anything and needs no network: the lockfile is a committed input.
 * Not run by `npm test` or `npm run test:l3`.
 *
 * To change the sample's dependencies, regenerate `base/package-lock.json` once with a networked
 * `npm install --package-lock-only` in a temp folder, update `lock-toolchain.json`, then run this script.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const IDENTITY = { name: 'Factory Sandbox', email: 'factory-sandbox@example.invalid' } as const;

const VERSIONS = [
  { tag: 'todo-v0', inputs: 'base', date: '2024-01-01T12:00:00+01:00', message: 'A working to-do app: add, tick and list todos' },
  { tag: 'todo-v1', inputs: 'v1', date: '2024-01-02T12:00:00+01:00', message: 'Planted bug: ticking a todo ticks the row below it' },
  { tag: 'todo-v2', inputs: 'v2', date: '2024-01-03T12:00:00+01:00', message: 'Planted UI delta: the heading is too pale to read' },
] as const;

/** Fixed content of .git/config: `git init` would add settings that depend on the machine (case rules, unicode form). */
const GIT_CONFIG = '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = false\n';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const INPUTS_DIR = join(SCRIPT_DIR, 'sandbox', 'todo-app');
const DEFAULT_OUT_DIR = join(SCRIPT_DIR, '..', 'test', 'fixtures', 'sandbox');

function git(cwd: string, date: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: IDENTITY.name,
      GIT_AUTHOR_EMAIL: IDENTITY.email,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: IDENTITY.name,
      GIT_COMMITTER_EMAIL: IDENTITY.email,
      GIT_COMMITTER_DATE: date,
    },
  }).trim();
}

/** Builds the repo in `work`: one commit and one annotated tag per version, `main` at the last one. */
function buildRepo(work: string): void {
  git(work, VERSIONS[0].date, ['init', '--quiet', '--template=', '--initial-branch=main']);
  for (const version of VERSIONS) {
    cpSync(join(INPUTS_DIR, version.inputs), work, {
      recursive: true,
      filter: (source) => !source.endsWith('.DS_Store'),
    });
    git(work, version.date, ['add', '--all']);
    git(work, version.date, ['commit', '--quiet', '--no-verify', '--message', version.message]);
    git(work, version.date, ['tag', '--annotate', '--message', version.message, version.tag]);
  }
  // Keep only what is the same on every machine: no index (it holds file stat data), no logs, a fixed config.
  writeFileSync(join(work, '.git', 'config'), GIT_CONFIG, 'utf8');
  rmSync(join(work, '.git', 'index'), { force: true });
  rmSync(join(work, '.git', 'logs'), { recursive: true, force: true });
}

interface PackEntry {
  name: string;
  data: Buffer;
  isDir: boolean;
  executable: boolean;
}

/** Every folder and file under `root` (the work tree and `.git`, minus the index), sorted by name bytes. */
function collect(root: string): PackEntry[] {
  const entries: PackEntry[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const name = `${prefix}${item.name}`;
      if (name === '.git/index') continue;
      if (item.isDirectory()) {
        entries.push({ name: `${name}/`, data: Buffer.alloc(0), isDir: true, executable: false });
        walk(join(dir, item.name), `${name}/`);
      } else if (item.isFile()) {
        const full = join(dir, item.name);
        entries.push({ name, data: readFileSync(full), isDir: false, executable: (statSync(full).mode & 0o111) !== 0 });
      } else {
        throw new Error(`${name} is not a regular file or folder`);
      }
    }
  };
  walk(root, '');
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of `entries` with fixed times (1980-01-01) and fixed unix modes, so the same input gives the same bytes. */
function zipBytes(entries: PackEntry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = entry.isDir ? Buffer.alloc(0) : deflateRawSync(entry.data, { level: 9 });
    const method = entry.isDir ? 0 : 8;
    const crc = crc32(entry.data);
    const mode = entry.isDir ? 0o040755 : entry.executable ? 0o100755 : 0o100644;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(33, 12); // date 1980-01-01, time 00:00:00
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, compressed);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE((3 << 8) | 20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(method, 10);
    head.writeUInt16LE(33, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(compressed.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE((mode << 16) >>> 0, 38);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

/** Builds the fixture into `outDir` and returns the manifest it wrote. */
export function packTodoSandbox(outDir: string): Record<string, unknown> {
  const work = mkdtempSync(join(tmpdir(), 'todo-pack-'));
  try {
    buildRepo(work);
    const tags: Record<string, { tagObject: string; commit: string }> = {};
    const dates: Record<string, string> = {};
    for (const { tag, date } of VERSIONS) {
      tags[tag] = {
        tagObject: git(work, date, ['rev-parse', `refs/tags/${tag}`]),
        commit: git(work, date, ['rev-parse', `${tag}^{commit}`]),
      };
      dates[tag] = git(work, date, ['for-each-ref', `refs/tags/${tag}`, '--format=%(taggerdate:iso-strict)']);
    }
    const zip = zipBytes(collect(work));
    const toolchain = JSON.parse(readFileSync(join(INPUTS_DIR, 'lock-toolchain.json'), 'utf8')) as { node: string; npm: string };
    const manifest = {
      zipSha256: createHash('sha256').update(zip).digest('hex'),
      identity: IDENTITY,
      dates,
      tags,
      node: toolchain.node,
      npm: toolchain.npm,
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'todo-app.zip'), zip);
    chmodSync(join(outDir, 'todo-app.zip'), 0o644);
    writeFileSync(join(outDir, 'todo-app.manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return manifest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outFlag = process.argv.indexOf('--out');
  const outDir = outFlag === -1 ? DEFAULT_OUT_DIR : resolve(process.argv[outFlag + 1] ?? DEFAULT_OUT_DIR);
  const manifest = packTodoSandbox(outDir);
  console.log(`Wrote ${join(outDir, 'todo-app.zip')} (sha256 ${String(manifest.zipSha256)})`);
}
