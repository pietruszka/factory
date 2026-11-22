const REGEXP_SPECIAL = /[.+^${}()|[\]\\]/;

/**
 * The regular expression of one glob, matched against a whole worktree path with `/` separators.
 * `*` is any run of characters inside one path segment, `?` is one character inside a segment,
 * `**` is any run of characters across segments, and `**` followed by `/` also matches no segment
 * at all (`a/**` + `/b` matches `a/b`). Everything else is literal. A trailing `/` means the whole folder.
 */
function globToRegExp(glob: string): RegExp {
  const pattern = glob.endsWith('/') ? `${glob}**` : glob;
  let source = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else {
      const char = pattern.charAt(i);
      source += char === '*' ? '[^/]*' : char === '?' ? '[^/]' : REGEXP_SPECIAL.test(char) ? `\\${char}` : char;
      i += 1;
    }
  }
  return new RegExp(`^${source}$`, 's');
}

/** True when the worktree-relative `path` matches at least one glob. Not for the prefix overlap of `allowed_paths`. */
export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
