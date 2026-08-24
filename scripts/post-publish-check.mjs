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
 * version can still 404 for a few seconds while the index catches up. So this
 * script POLLS until the version is visible (or a timeout elapses) before
 * judging it, printing ONE progress line per retry — never an error block.
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

/** The registry's JSON document for one version, or null when not visible yet. */
async function fetchVersionDoc() {
  try {
    const response = await fetch(`${REGISTRY}/${encodeURIComponent(name)}/${version}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (response.status !== 200) return null
    return await response.json()
  } catch {
    return null // network hiccup counts as "not visible yet"; polling handles it
  }
}

// Poll until the published version is visible in the registry index.
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 14 // up to ~42s of waiting
let doc = await fetchVersionDoc()
for (let attempt = 1; doc === null && attempt <= POLL_ATTEMPTS; attempt += 1) {
  console.log(`post-publish-check: not visible yet — index catching up; retry ${attempt}/${POLL_ATTEMPTS}`)
  await sleep(POLL_INTERVAL_MS)
  doc = await fetchVersionDoc()
}
if (doc === null) {
  console.error(`\n⚠️  ${name}@${version} did not become visible on the registry after `
    + `${Math.round((POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000)}s of polling.`)
  console.error('   The publish may have failed before the upload completed, or the index')
  console.error('   is still catching up. Verify manually at https://www.npmjs.com/package/'
    + `${name} or with \`curl ${REGISTRY}/${name}\`.`)
  console.error(`   Do NOT re-publish ${version} without checking — it may be live.`)
  process.exit(1)
}
console.log(`✅ version ${version} is visible on the registry`)

// 1. dist-tags.latest matches the published version.
let latest
try {
  const response = await fetch(`${REGISTRY}/-/package/${encodeURIComponent(name)}/dist-tags`)
  if (!response.ok) throw new Error(`registry answered HTTP ${response.status} for dist-tags`)
  const distTags = await response.json()
  latest = typeof distTags.latest === 'string' ? distTags.latest : undefined
  if (latest === undefined) problems.push(`dist-tags has no "latest" (got: ${JSON.stringify(distTags)})`)
  else if (latest !== version) problems.push(`registry "latest" is ${latest}, expected ${version}`)
} catch (error) {
  problems.push(`could not read dist-tags: ${error.message}`)
}
if (latest === version) console.log('✅ dist-tags.latest matches the published version')

// 2. The published tarball contains every expected file. The tarball URL and
// bytes both come from fetch; tar only LISTENS on stdin, so no curl/npm child
// can spray errors of its own.
const EXPECTED = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'package.json']
try {
  const tarballUrl = doc?.dist?.tarball
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
