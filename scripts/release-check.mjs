#!/usr/bin/env node
/**
 * Release gate: verifies every mandatory item of a release before it can be
 * published. Runs standalone (`pnpm release:check`) and automatically as part
 * of `prepack` and `prepublishOnly`, so both `npm publish` AND `npm pack`
 * (which is the bypass for publishing a pre-packed tarball) are BLOCKED until
 * the checklist passes.
 *
 * Mandatory items checked:
 *   1. README.md and README.zh.md exist and are non-trivial
 *   2. README.md and README.zh.md have the same number of `##` and `###`
 *      sections (bilingual structural sync)
 *   3. CHANGELOG.md has a NON-EMPTY entry for the current version, as the
 *      latest released entry
 *   4. package.json version == CHANGELOG latest entry version
 *   5. git tag `v<version>` exists and points at HEAD
 *   6. git working tree is clean (everything committed)
 *   7. lib/ is present AND fresh (no src/ file newer than the built output)
 *   8. version is not already published on npm (best effort)
 *
 * Known, documented limitations:
 *   - Section-count sync cannot verify translated CONTENT inside sections;
 *     human review still owns wording parity.
 *   - `npm publish --ignore-scripts` skips this gate entirely (explicit user
 *     override); the `npm pack` route is gated via `prepack`, but tarballs
 *     packed elsewhere are not. See CONTRIBUTING.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (file) => readFileSync(join(root, file), 'utf8')
const run = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8', timeout: 15000 }).trim()
const failures = []
const fail = (message) => failures.push(message)

/** The `## ` headings of a markdown file. */
function headings(file) {
  if (!existsSync(join(root, file))) return []
  return (read(file).match(/^## .*$/gm) ?? []).map((h) => h.replace(/^## /, '').trim())
}

/** The `### ` headings of a markdown file (subsection parity check). */
function subheadings(file) {
  if (!existsSync(join(root, file))) return []
  return (read(file).match(/^### .*$/gm) ?? []).map((h) => h.replace(/^### /, '').trim())
}

/** Newest modification time (ms) under a directory, walking recursively. */
function newestMtime(dir) {
  let newest = 0
  const walk = (current) => {
    for (const name of readdirSync(current)) {
      const full = join(current, name)
      const st = statSync(full)
      if (st.isDirectory()) walk(full)
      else if (st.mtimeMs > newest) newest = st.mtimeMs
    }
  }
  walk(dir)
  return newest
}

let version
try {
  version = JSON.parse(read('package.json')).version
} catch (error) {
  fail(`package.json unreadable: ${error.message}`)
}
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  fail(`package.json version "${String(version)}" is not a valid semver (x.y.z)`)
  process.exit(1)
}
console.log(`release-check: package version ${version}`)

// 1. + 2. bilingual READMEs present and structurally synced.
// Headings are translated, so equality is by SECTION COUNT: a release that
// adds/removes a `##`/`###` section in one language but not the other is drift.
for (const file of ['README.md', 'README.zh.md']) {
  if (!existsSync(join(root, file))) fail(`${file} is missing — write/update it for this release`)
}
const enHeadings = headings('README.md')
const zhHeadings = headings('README.zh.md')
if (enHeadings.length !== zhHeadings.length) {
  fail(
    `bilingual READMEs are out of sync: README.md has ${enHeadings.length} sections, `
    + `README.zh.md has ${zhHeadings.length} — add/remove the same section in both files`,
  )
}
const enSub = subheadings('README.md')
const zhSub = subheadings('README.zh.md')
if (enSub.length !== zhSub.length) {
  fail(
    `bilingual READMEs are out of sync: README.md has ${enSub.length} subsections, `
    + `README.zh.md has ${zhSub.length} — add/remove the same subsection in both files`,
  )
}

// 3. + 4. CHANGELOG entry for this version, as the latest released entry,
//    and non-empty (a heading with no content describes nothing).
let changelog
try {
  changelog = read('CHANGELOG.md')
} catch {
  fail('CHANGELOG.md is missing — create it with a [Unreleased] section')
}
const sections = changelog.split(/^## /m).slice(1)
const entry = sections.find((s) => s.startsWith(`[${version}]`))
if (!entry) {
  fail(`CHANGELOG.md has no entry for [${version}] — add one`)
} else {
  const body = entry.slice(entry.indexOf('\n') + 1).trim()
  if (!/[-*]|^###/m.test(body)) fail(`CHANGELOG.md entry for [${version}] is empty — describe the change`)
}
const releasedFirst = sections.map((s) => s.match(/^\[(\d+\.\d+\.\d+)\]/)?.[1]).find(Boolean)
if (releasedFirst && releasedFirst !== version) {
  fail(`CHANGELOG.md latest released entry is [${releasedFirst}], expected [${version}]`)
}

// 5. git tag v<version> exists and points at HEAD.
const tag = `v${version}`
let head
try {
  head = run('git rev-parse HEAD')
} catch {
  fail('not a git repository — release must be committed and tagged')
}
let tagHead
try {
  tagHead = run(`git rev-parse -q --verify refs/tags/${tag}^{commit}`)
} catch {
  tagHead = ''
}
if (tagHead === '') {
  fail(`git tag ${tag} does not exist — commit and tag the release first`)
} else if (tagHead !== head) {
  fail(`git tag ${tag} does not point at HEAD — tag the release commit`)
}

// 6. clean working tree.
const status = run('git status --porcelain')
if (status.length > 0) fail(`working tree is not clean — commit everything first:\n${status}`)

// 7. lib/ present AND fresh (no src/ file newer than the built output).
let stale = []
for (const artifact of ['lib/client.js', 'lib/index.js']) {
  if (!existsSync(join(root, artifact))) fail(`${artifact} is missing — run pnpm bundle first`)
}
if (existsSync(join(root, 'src'))) {
  const srcNewest = newestMtime(join(root, 'src'))
  for (const artifact of ['lib/client.js', 'lib/index.js']) {
    const st = statSync(join(root, artifact))
    if (srcNewest > st.mtimeMs + 1000) {
      stale.push(relative(root, join(root, artifact)))
    }
  }
}
if (stale.length > 0) {
  fail(`build output is stale (src/ newer than ${stale.join(', ')}) — run pnpm bundle first`)
}

// 8. not already published — probed DIRECTLY against the registry index with
// the built-in fetch. `npm view <pkg>@<unpublished>` is functionally correct
// but prints a 9-line E404 error block on every call (prepublishOnly + prepack
// = two blocks per publish), so a SUCCESSFUL publish showed "满屏错误 + ✅".
// Only an explicit HTTP 200 means "already published"; 404 and network
// failure both mean "not published / index unreachable".
try {
  const probe = await fetch(`https://registry.npmjs.org/dsh-model-reasoning/${version}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (probe.status === 200) {
    fail(`version ${version} is already published on npm — bump the version`)
  } else {
    console.log(`release-check: ${version} is NOT published yet — safe to publish`)
  }
} catch {
  console.log('release-check: registry unreachable — skipping the already-published probe')
}

if (failures.length > 0) {
  console.error('\n❌ release-check FAILED — release is BLOCKED:')
  for (const f of failures) console.error(`   - ${f}`)
  console.error('\nFix every item above, then re-run `pnpm release:check`.')
  process.exit(1)
}

console.log('✅ release-check passed: version, docs, changelog, tag, tree, build, registry all consistent.')
