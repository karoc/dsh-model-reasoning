#!/usr/bin/env node
/**
 * Post-publish verification, run by npm's `postpublish` lifecycle AFTER the
 * package has been uploaded.
 *
 * It CANNOT prevent a bad publish — the upload already happened. Its job is to
 * confirm the release actually landed on the registry and to raise a loud,
 * unambiguous alarm when it did not, so a silent/partial publish is never
 * mistaken for success.
 *
 * Registry eventual consistency: right after upload, the freshly published
 * version can still 404 while the index catches up — MEASURED at several
 * minutes, not seconds (@karoc/dsh-proxy 0.1.1 took ~4 minutes; on 2026-09-19
 * a 60s window reported a successful sibling-plugin publish as a failure while
 * npm had already returned PUT 200), so this script POLLS for up to ~5 minutes
 * before judging it, printing only an occasional progress line — never an
 * error block.
 *
 * Timeout semantics: postpublish runs ONLY after the upload succeeded, so a
 * version that stays invisible is almost always index lag, not a failed
 * publish. The script therefore distinguishes:
 *   - package document visible (any version) → the package IS on the registry;
 *     the new version is just not indexed yet → treat as published (exit 0)
 *     with a clear "verify manually, do not re-publish" note;
 *   - package document also 404 → genuinely unconfirmed → exit 1.
 *
 * All registry reads use the built-in `fetch` directly instead of the npm CLI:
 * `npm view <pkg>@<missing>` prints a 9-line E404 block on every miss, which
 * turned a successful publish into "满屏错误 + ✅" (dsh-kanban 0.2.0 实录).
 *
 * Checks (after the version becomes visible):
 *   1. `dist-tags.latest` on the registry equals package.json version
 *   2. the published tarball contains every expected file
 *
 * Like every lifecycle script, it is skipped by `npm publish --ignore-scripts`
 * (documented in CONTRIBUTING.md).
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const REGISTRY = 'https://registry.npmjs.org'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = pkg
const problems = []

console.log(`post-publish-check: ${name}@${version}`)

/** The registry's full package document, or null when unreachable/absent. The
 * version must be read from `versions[version]` in this doc rather than from
 * the version endpoint (`/<pkg>/<version>`): that endpoint intermittently
 * answers HTTP 406 for the abbreviated-metadata accept header even for long
 * published versions, which turned a successful publish into a false
 * "not visible" alarm (dsh-model-reasoning 0.2.2 实录). The full doc endpoint
 * serves plain JSON reliably and is the index `npm view` reads. */
async function fetchIndexDoc() {
  try {
    const response = await fetch(`${REGISTRY}/${encodeURIComponent(name)}`)
    if (response.status !== 200) return null
    return await response.json()
  } catch {
    return null // network hiccup counts as "not visible yet"; polling handles it
  }
}

// Poll until the published version is visible in the registry index.
// npm's own message says indexing "may take a few minutes", so allow 5 min.
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 100 // up to ~5 minutes of waiting
let doc = await fetchIndexDoc()
let versionDoc = doc?.versions?.[version]
for (let attempt = 1; versionDoc === undefined && attempt <= POLL_ATTEMPTS; attempt += 1) {
  if (attempt % 10 === 1 || attempt === POLL_ATTEMPTS) {
    console.log(`post-publish-check: not visible yet — index catching up; retry ${attempt}/${POLL_ATTEMPTS}`)
  }
  await sleep(POLL_INTERVAL_MS)
  doc = await fetchIndexDoc()
  versionDoc = doc?.versions?.[version]
}
if (versionDoc === undefined) {
  // Distinguish "index lag on a live package" from "package not found at all".
  // postpublish only runs after the upload PUT succeeded, so a timeout means
  // the index has not caught up — not that the publish failed.
  if (doc !== null) {
    console.error(`\n⚠️  version ${version} is not indexed yet after 5 minutes of polling,`)
    console.error('   but the package document IS live on the registry — the upload succeeded.')
    console.error('   The index is still catching up (npm: "may take a few minutes").')
    console.error(`   Verify shortly with: npm view ${name} versions`)
    console.error(`   Do NOT re-publish ${version} — it is live or about to be.`)
    process.exit(0)
  }
  console.error(`\n⚠️  ${name}@${version} did not become visible on the registry after `
    + `${Math.round((POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000)}s of polling,`)
  console.error('   and the package document is not visible either.')
  console.error('   The publish may have failed before the upload completed, or the index')
  console.error('   is still extremely slow. Verify manually at https://www.npmjs.com/package/'
    + `${name} or with \`curl ${REGISTRY}/${name}\`.`)
  console.error(`   Do NOT re-publish ${version} without checking — it may be live.`)
  process.exit(1)
}
console.log(`✅ version ${version} is visible on the registry`)

// 1. dist-tags.latest matches the published version. This is ALSO an
//    eventual-consistency surface — npm writes the version document first and
//    flips `latest` moments later (real incident: "latest is 0.1.2, expected
//    0.1.3" right after a successful publish), so poll it at the same cadence
//    as version visibility instead of trusting a single snapshot.
let latest = undefined
let distTags = {}
let lastDistTagError = undefined
for (let attempt = 0; attempt <= POLL_ATTEMPTS; attempt += 1) {
  if (attempt > 0) {
    console.log(`   (dist-tag "latest" not yet ${version} — registry tag update catching up; retry ${attempt}/${POLL_ATTEMPTS})`)
    await sleep(POLL_INTERVAL_MS)
  }
  try {
    const pkgDoc = await fetchIndexDoc()
    distTags = pkgDoc?.['dist-tags'] ?? {}
    latest = typeof distTags.latest === 'string' ? distTags.latest : undefined
  } catch (error) {
    // Probe failure — keep polling rather than failing on a transient blip.
    lastDistTagError = error
  }
  if (latest === version) break
}
if (latest === undefined) {
  problems.push(lastDistTagError
    ? `could not read dist-tags: ${lastDistTagError.message}`
    : `dist-tags has no "latest" (got: ${JSON.stringify(distTags)})`)
} else if (latest !== version) {
  problems.push(`registry "latest" is ${latest}, expected ${version} — if this publish used an explicit --tag, the mismatch is expected; otherwise check the dist-tag`)
}
if (latest === version) console.log('✅ dist-tags.latest matches the published version')

// 2. The published tarball contains every expected file. The tarball URL and
// bytes both come from fetch; tar only LISTENS on stdin, so no curl/npm child
// can spray errors of its own.
const EXPECTED = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'package.json']
try {
  const tarballUrl = versionDoc?.dist?.tarball
  if (typeof tarballUrl !== 'string' || tarballUrl.length === 0) throw new Error('registry returned no tarball URL')
  const response = await fetch(tarballUrl)
  if (!response.ok) throw new Error(`tarball download failed with HTTP ${response.status}`)
  const listing = execSync('tar -tzf -', {
    cwd: root, encoding: 'utf8', timeout: 25000,
    input: Buffer.from(await response.arrayBuffer()),
  })
  for (const file of EXPECTED) {
    if (!listing.includes(`package/${file}`)) problems.push(`published tarball is missing package/${file}`)
  }
  const allPresent = EXPECTED.every((file) => listing.includes(`package/${file}`))
  if (allPresent) console.log('✅ published tarball contains all expected files')
} catch (error) {
  problems.push(`could not inspect published tarball: ${error.message}`)
}

if (problems.length > 0) {
  console.error('\n⚠️  post-publish-check found problems:')
  for (const p of problems) console.error(`   - ${p}`)
  console.error(`\n   IMPORTANT: ${name}@${version} IS on the registry — the publish itself`)
  console.error('   completed. These are POST-publish findings; do NOT re-publish the same version.')
  console.error('   Fix the cause and address it in the next release.')
  process.exit(1)
}

console.log('\n✅ post-publish-check passed: release is live and consistent on npm.')
