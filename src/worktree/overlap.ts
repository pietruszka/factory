const WILDCARD = /[*?[{]/;

/** The leading path segments of a glob that contain no wildcard. */
function literalPrefix(glob: string): string[] {
  const segments = glob.split('/').filter((segment) => segment !== '' && segment !== '.');
  const firstWildcard = segments.findIndex((segment) => WILDCARD.test(segment));
  return firstWildcard === -1 ? segments : segments.slice(0, firstWildcard);
}

function isPrefixOf(shorter: readonly string[], longer: readonly string[]): boolean {
  return shorter.every((segment, index) => segment === longer[index]);
}

/** Two globs may match a common path unless their literal prefixes diverge at some segment. */
function globsMayShare(a: string, b: string): boolean {
  const prefixA = literalPrefix(a);
  const prefixB = literalPrefix(b);
  return prefixA.length <= prefixB.length ? isPrefixOf(prefixA, prefixB) : isPrefixOf(prefixB, prefixA);
}

/**
 * Conservative overlap of two allowed-path lists. A missing or empty list means every path.
 * Only the literal prefix (whole segments before the first wildcard) is compared, so a pair that
 * cannot be proven disjoint counts as overlapping.
 */
export function allowedPathsOverlap(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const everything = ['**'];
  const left = a === undefined || a.length === 0 ? everything : a;
  const right = b === undefined || b.length === 0 ? everything : b;
  return left.some((globA) => right.some((globB) => globsMayShare(globA, globB)));
}
