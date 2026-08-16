#!/usr/bin/env node
/**
 * Release gate: verifies every mandatory item of a release before it can be
 * published. Runs standalone (`pnpm release:check`) and automatically as part
 * of `prepublishOnly`, so `npm publish` is BLOCKED until the checklist passes.
 *
 * Mandatory items checked:
 *   1. README.md and README.zh.md exist
 *   2. README.md and README.zh.md have the same `##` section headings (bilingual sync)
 *   3. CHANGELOG.md has an entry for the current version, as the latest released entry
 *   4. package.json version == CHANGELOG latest entry version
 *   5. git tag `v<version>` exists and points at HEAD
 *   6. git working tree is clean (everything committed)
 *   7. lib/client.js exists (build output present)
 *   8. version is not already published on npm (best effort)
 */
import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (file) => readFileSync(join(root, file), 'utf8')
const failures = []
const fail = (message) => failures.push(message)

/** The `## ` headings of a markdown file (comparison strips order-insensitive? no — order matters for parity). */
function headings(file) {
  if (!existsSync(join(root, file))) return []
  return (read(file).match(/^## .*$/gm) ?? []).map((h) => h.replace(/^## /, '').trim())
}

let version
try {
  version = JSON.parse(read('package.json')).version
} catch (error) {
  fail(`package.json unreadable: ${error.message}`)
  process.exit(1)
}
console.log(`release-check: package version ${version}`)

// 1. + 2. bilingual READMEs present and section-synced.
// Headings are translated (English vs 简体中文), so equality is by SECTION
// COUNT: a release that adds/removes a `##` section in one language but not
// the other is a drift that must be fixed before publishing.
for (const file of ['README.md', 'README.zh.md']) {
  if (!existsSync(join(root, file))) fail(`${file} is missing — write/update it for this release`)
}
const enHeadings = headings('README.md')
const zhHeadings = headings('README.zh.md')
if (enHeadings.length !== zhHeadings.length) {
  fail(
    `bilingual READMEs are out of sync: README.md has ${enHeadings.length} sections, `
    + `README.zh.md has ${zhHeadings.length} — add/remove the same section in both files`
  )
}

// 3. + 4. CHANGELOG entry for this version, as the latest released entry
let changelog
try {
  changelog = read('CHANGELOG.md')
} catch {
  fail('CHANGELOG.md is missing — create it with a [Unreleased] section')
}
const escaped = version.replace(/\./g, '\\.')
if (!new RegExp(`^## \\[${escaped}\\]`, 'm').test(changelog)) {
  fail(`CHANGELOG.md has no entry for [${version}] — add one`)
}
const latestReleased = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)
if (latestReleased && latestReleased[1] !== version) {
  fail(`CHANGELOG.md latest released entry is [${latestReleased[1]}], expected [${version}]`)
}

// 5. tag v<version> on HEAD
const tag = `v${version}`
try {
  const describe = execSync('git describe --tags --exact-match HEAD', { cwd: root, encoding: 'utf8' }).trim()
  if (describe !== tag) fail(`HEAD is tagged ${describe}, expected ${tag} — tag the release commit`)
} catch {
  fail(`no git tag ${tag} on HEAD — commit and tag the release first`)
}

// 6. clean working tree
const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim()
if (status.length > 0) fail(`working tree is not clean — commit everything first:\n${status}`)

// 7. build output present
if (!existsSync(join(root, 'lib/client.js'))) fail('lib/client.js is missing — run pnpm bundle first')

// 8. not already published (best effort; offline or 404 means not published)
try {
  const published = execSync(
    `npm view ${JSON.stringify('dsh-model-reasoning')}@${version} version`,
    { cwd: root, encoding: 'utf8' },
  ).trim()
  if (published.length > 0) fail(`version ${version} is already published on npm (${published}) — bump the version`)
} catch {
  // E404 or network failure: treated as "not published yet"
}

if (failures.length > 0) {
  console.error('\n❌ release-check FAILED — release is BLOCKED:')
  for (const f of failures) console.error(`   - ${f}`)
  console.error('\nFix every item above, then re-run `pnpm release:check`.')
  process.exit(1)
}

console.log('✅ release-check passed: version, docs, changelog, tag, tree, build, registry all consistent.')
