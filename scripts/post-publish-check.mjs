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
 * Registry eventual consistency: right after upload, `npm view <pkg>@<version>`
 * can still 404 for a few seconds while the index catches up. So this script
 * POLLS until the version is visible (or a timeout elapses) before judging it.
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
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, encoding: 'utf8', timeout: 20000, ...opts }).trim()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = pkg
const problems = []

console.log(`post-publish-check: ${name}@${version}`)

/** True once `npm view <pkg>@<version>` stops 404-ing (index caught up). */
function versionVisible() {
  try {
    return run(`npm view ${JSON.stringify(name)}@${version} version`).length > 0
  } catch {
    return false
  }
}

// Poll until the published version is visible in the registry index.
const POLL_INTERVAL_MS = 3000
const POLL_ATTEMPTS = 14 // up to ~42s of waiting
let visible = versionVisible()
for (let attempt = 1; !visible && attempt <= POLL_ATTEMPTS; attempt += 1) {
  await sleep(POLL_INTERVAL_MS)
  visible = versionVisible()
}
if (!visible) {
  console.error(`\n⚠️  ${name}@${version} did not become visible on the registry after `
    + `${Math.round((POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000)}s of polling.`)
  console.error('   The publish may have failed before the upload completed, or the index')
  console.error('   is still catching up. Verify manually with `npm view dsh-model-reasoning versions`.')
  console.error(`   Do NOT re-publish ${version} without checking — it may be live.`)
  process.exit(1)
}
console.log(`✅ version ${version} is visible on the registry`)

// 1. dist-tags.latest matches the published version.
let latest
try {
  const distTags = JSON.parse(run(`npm view ${JSON.stringify(name)} dist-tags --json`))
  latest = typeof distTags.latest === 'string' ? distTags.latest : undefined
  if (latest === undefined) problems.push(`dist-tags has no "latest" (got: ${JSON.stringify(distTags)})`)
  else if (latest !== version) problems.push(`registry "latest" is ${latest}, expected ${version}`)
} catch (error) {
  problems.push(`could not parse dist-tags: ${error.message}`)
}
if (latest === version) console.log('✅ dist-tags.latest matches the published version')

// 2. The published tarball contains every expected file.
const EXPECTED = ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'package.json']
try {
  const tarball = run(`npm view ${JSON.stringify(name)}@${version} dist.tarball`)
  if (tarball.length === 0) throw new Error('registry returned no tarball URL')
  const listing = execSync(`curl -s --max-time 20 ${JSON.stringify(tarball)} | tar -tzf -`, {
    cwd: root, encoding: 'utf8', timeout: 25000,
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
