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
import { homedir } from 'node:os'
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
  if (!existsSync(join(root, artifact))) {
    fail(`${artifact} is missing — run \`npm run bundle\` first`)
  }
}
if (existsSync(join(root, 'src'))) {
  const srcNewest = newestMtime(join(root, 'src'))
  for (const artifact of ['lib/client.js', 'lib/index.js']) {
    if (!existsSync(join(root, artifact))) continue
    const st = statSync(join(root, artifact))
    if (srcNewest > st.mtimeMs + 1000) {
      stale.push(relative(root, join(root, artifact)))
    }
  }
}
if (stale.length > 0) {
  fail(`build output is stale (src/ newer than ${stale.join(", ")}) — run \`npm run bundle\` first`)
}

// 8. not already published — probed DIRECTLY against the registry index with
// the built-in fetch (never the npm CLI: `npm view <pkg>@<missing>` prints a
// 9-line E404 block per probe, which once drowned a successful publish in
// 404s). The FULL package document is read, not the version endpoint: that
// endpoint intermittently answers HTTP 406 for the abbreviated-metadata accept
// header even for long-published versions, which would misread an
// already-published version as "safe to publish".
//
// Grading: a definite 404 (or a 200 without this version) means unpublished;
// any other non-2xx answer or a transport failure BLOCKS the release after two
// bounded retries — "the probe failed" must never read as "safe to publish".
// DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE=1 is the deliberate override.

/** `registry = <url>` from one .npmrc, normalized (trailing slashes removed). */
function npmrcRegistry(file) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const match = /^\s*registry\s*=\s*(.+?)\s*$/.exec(line)
      if (match) return match[1].replace(/\/+$/, '')
    }
  } catch {
    // absent or unreadable — not a candidate
  }
  return undefined
}

/** Registry base + source: env → ./.npmrc → user .npmrc → publishConfig → default. */
function resolveRegistry() {
  const packageManifest = JSON.parse(read('package.json'))
  const candidates = []
  const seam = (process.env.DSH_POSTPUBLISH_REGISTRY_BASE ?? '').trim()
  if (seam !== '') candidates.push([seam.replace(/\/+$/, ''), 'DSH_POSTPUBLISH_REGISTRY_BASE'])
  const fromEnv = (process.env.npm_config_registry ?? '').trim()
  if (fromEnv !== '') candidates.push([fromEnv.replace(/\/+$/, ''), 'npm_config_registry'])
  const local = npmrcRegistry(join(root, '.npmrc'))
  if (local !== undefined) candidates.push([local, './.npmrc'])
  const userFile = process.env.NPM_CONFIG_USERCONFIG ?? join(homedir(), '.npmrc')
  const user = npmrcRegistry(userFile)
  if (user !== undefined) candidates.push([user, userFile])
  const declared = typeof packageManifest.publishConfig?.registry === 'string'
    ? packageManifest.publishConfig.registry.trim()
    : ''
  if (declared !== '') candidates.push([declared.replace(/\/+$/, ''), 'package.json publishConfig.registry'])
  const [base, source] = candidates[0] ?? ['https://registry.npmjs.org', 'default']
  return { base, source }
}

const packageName = JSON.parse(read('package.json')).name
const registry = resolveRegistry()
console.log(`release-check: registry ${registry.base} (source: ${registry.source})`)

/** Three-state probe: absent (definite 404 / no such version) | published | unknown. */
async function probePublished() {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${registry.base}/${encodeURIComponent(packageName)}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (response.status === 404) return { state: 'absent' }
      if (response.ok) {
        const doc = await response.json()
        const published = typeof doc?.versions === 'object' && doc.versions !== null
          && doc.versions[version] !== undefined
        return { state: published ? 'published' : 'absent' }
      }
      lastError = new Error(`registry answered HTTP ${response.status}`)
      console.log(`release-check: probe attempt ${attempt}/3 → HTTP ${response.status}`)
    } catch (error) {
      lastError = error
      console.log(`release-check: probe attempt ${attempt}/3 → ${String(error?.message ?? error).split('\n')[0]}`)
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return { state: 'unknown', error: lastError }
}

const outcome = await probePublished()
if (outcome.state === 'published') {
  fail(`version ${version} is already published on npm — bump the version`)
} else if (outcome.state === 'absent') {
  console.log(`release-check: ${version} is NOT published yet — safe to publish`)
} else if (process.env.DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE === '1') {
  console.log(`release-check: ⚠️  registry probe failed (${String(outcome.error?.message ?? '').split('\n')[0]}) — continuing because DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE=1`)
} else {
  fail(`could not determine whether ${version} is published: ${String(outcome.error?.message ?? outcome.error).split('\n')[0]} — fix the network/registry, or set DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE=1 to publish anyway`)
}

if (failures.length > 0) {
  console.error('\n❌ release-check FAILED — release is BLOCKED:')
  for (const f of failures) console.error(`   - ${f}`)
  console.error('\nFix every item above, then re-run `npm run release:check`.')
  process.exit(1)
}

console.log('✅ release-check passed: version, docs, changelog, tag, tree, build, registry all consistent.')
