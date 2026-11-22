import { resolveComparablePath } from '../platform/path-helpers.js';

const SCHEMES = new Set(['https:', 'http:', 'ssh:']);
const DEFAULT_PORTS = new Set(['443', '22']);
const BARE_FORM = /^([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?)\/(\S+)$/;
const SCP_FORM = /^(?:[^@\s/]+@)?([^:\s/]+):(?!\/\/)(\S+)$/;

function joinHostAndPath(host: string, path: string): string | undefined {
  const cleaned = path
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
  return host === '' || cleaned === '' ? undefined : `${host}/${cleaned}`;
}

/**
 * Reduces a git origin URL to `host/path` so https, ssh and scp forms of one repo compare equal.
 * Accepts `https://`, `http://`, `ssh://`, `git@host:path` and a bare `host/path`. Lower-cases scheme and host, drops
 * userinfo, default ports (443, 22), a trailing `.git` and trailing slashes. The path keeps its case.
 * Returns undefined when the text is not one of those forms.
 */
export function normaliseOrigin(url: string): string | undefined {
  const text = url.trim();
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text)) {
    let parsed: URL;
    try {
      parsed = new URL(text);
    } catch {
      return undefined;
    }
    if (!SCHEMES.has(parsed.protocol)) {
      return undefined;
    }
    const port = DEFAULT_PORTS.has(parsed.port) ? '' : parsed.port;
    return joinHostAndPath(`${parsed.hostname.toLowerCase()}${port === '' ? '' : `:${port}`}`, parsed.pathname);
  }

  const bare = BARE_FORM.exec(text);
  if (bare) {
    return joinHostAndPath((bare[1] ?? '').toLowerCase(), bare[2] ?? '');
  }

  const scp = SCP_FORM.exec(text);
  return scp ? joinHostAndPath((scp[1] ?? '').toLowerCase(), scp[2] ?? '') : undefined;
}

/** True when both paths resolve to the same absolute path: symlinks followed, case ignored on darwin. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return resolveComparablePath(a, platform) === resolveComparablePath(b, platform);
}
