/**
 * The release gate's DOCUMENTED post-release failures.
 *
 * `release-check.mjs` guards a release BEFORE it is published, so a version that
 * IS published — and a tag that therefore no longer points at HEAD once work
 * continues — fail it by design. Two consumers must not treat that state as a
 * broken repo:
 *
 *  - `verify-all.mjs` (its release-check step is allowed to fail with these
 *    items only, and reports any other item as a failed step);
 *  - the positive control in `test-negative-controls.mjs` (an unmutated clone
 *    must pass, or fail with these items only).
 *
 * Anything else — stale build, dirty tree, missing CHANGELOG entry, a tag that
 * does not exist, a files-whitelist gap — stays a hard failure. Keep this list
 * narrow: every pattern here weakens the gate that consumes it, and the
 * negative controls exist to prove the other items still turn red.
 */

/** Failure lines that only describe the documented post-release state. */
export const DOCUMENTED_POST_RELEASE_FAILURES = [
  /is already published on npm/,
  /does not point at HEAD/,
]

/** Failure items (`   - …` lines) of one release-check run. */
export function releaseCheckFailures(output) {
  return String(output ?? '')
    .split('\n')
    .filter((line) => /^\s+- /.test(line))
    .map((line) => line.replace(/^\s+- /, '').trim())
}

/** Failure items that the documented post-release state does NOT explain. */
export function undocumentedReleaseFailures(output) {
  return releaseCheckFailures(output)
    .filter((item) => !DOCUMENTED_POST_RELEASE_FAILURES.some((pattern) => pattern.test(item)))
}
