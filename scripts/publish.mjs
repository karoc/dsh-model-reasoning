#!/usr/bin/env node
/**
 * Two-phase release: gate → pack → verify the packed tarball → publish THAT
 * tarball (npm runs no lifecycle scripts for a tarball argument) → advisory
 * verification.
 *
 * Why: `npm publish` runs `prepare` AFTER `prepack`, so the artifact shipped by
 * the plain command is rebuilt after every gate that inspected the tree; and a
 * failing `postpublish` makes npm exit nonzero even though the upload landed.
 * Publishing the already-verified tarball removes both holes and avoids
 * `npm publish --dry-run` (which runs publish + postpublish and is not a
 * rehearsal).
 *
 * Usage:
 *   npm run publish:release                 # full gate + publish
 *   npm run publish:release -- --skip-tests # skip `npm test` (already green)
 *   npm run publish:release -- --dry-run    # everything except the upload
 *   npm run publish:release -- --skip-gate  # already-verified checkout (post-release state)
 *   npm run publish:release -- --pack-only  # gate + build + pack + verify, no upload
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const skipTests = args.includes('--skip-tests')
const skipGate = args.includes('--skip-gate')
const packOnly = args.includes('--pack-only')
const dryRun = args.includes('--dry-run')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = pkg

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, { cwd: root, stdio: 'inherit', ...options })
}

function runCapture(command, commandArgs) {
  return execFileSync(command, commandArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function fail(message) {
  console.error(`publish:release: ❌ ${message}`)
  process.exit(1)
}

console.log(`publish:release: ${name}@${version}${dryRun ? ' (dry run)' : ''}`)

// 1. Gate. The release gate (tag/version/tree/CHANGELOG) plus the full suite.
if (!skipTests) {
  console.log('publish:release: gate — npm test')
  run('npm', ['test'])
}
if (!skipGate) {
  console.log('publish:release: gate — release-check')
  run('node', ['scripts/release-check.mjs'])
}

// 2. Build once, then pack with lifecycle scripts disabled. `npm pack` would
//    otherwise run prepare (a rebuild) and its build output would corrupt the
//    machine-readable `--json` stream.
console.log('publish:release: building')
run('npm', ['run', 'bundle', '--if-present'])
run('npm', ['run', 'prepare', '--if-present'])
console.log('publish:release: packing')
const packed = JSON.parse(runCapture('npm', ['pack', '--json', '--ignore-scripts']))[0]
const tarball = join(root, packed.filename)
if (!existsSync(tarball) || statSync(tarball).size === 0) fail('npm pack produced no tarball')

// 3. Verify the packed bytes (not the working tree): non-empty, readable tar,
//    every declared `files` entry present (directory entries match prefixes),
//    and record the digest that the registry must serve.
const listing = execFileSync('tar', ['-tzf', tarball], { cwd: root, encoding: 'utf8' })
  .split('\n').filter((line) => line.trim() !== '')
if (listing.length === 0) fail('packed tarball listing is empty')
const files = Array.isArray(pkg.files) ? pkg.files.filter((entry) => typeof entry === 'string' && !entry.startsWith('!')) : []
const expected = [...files.map((entry) => entry.replace(/^\.\//, '')), 'package.json']
const missing = expected.filter((entry) => !listing.includes(`package/${entry}`)
  && !listing.some((line) => line.startsWith(`package/${entry}/`)))
if (missing.length > 0) fail(`packed tarball is missing: ${missing.join(', ')}`)
const buffer = readFileSync(tarball)
const sha512 = createHash('sha512').update(buffer).digest('base64')
const sha256 = createHash('sha256').update(buffer).digest('hex')
mkdirSync(join(root, '.verify'), { recursive: true })
writeFileSync(join(root, '.verify/pack.json'), `${JSON.stringify({
  name, version, filename: packed.filename, size: buffer.length, sha256, integrity: `sha512-${sha512}`, entries: listing.length, packedAt: new Date().toISOString(),
}, null, 2)}\n`)
console.log(`publish:release: verified pack — ${listing.length} entries, sha512 ${sha512.slice(0, 16)}…`)

// 4. Publish the verified tarball. npm runs no lifecycle scripts for a tarball
//    argument, so the bytes verified above are exactly the bytes uploaded.
if (packOnly) {
  console.log(`publish:release: pack-only — verified ${packed.filename}; not uploading`)
  process.exit(0)
}
if (dryRun) {
  console.log('publish:release: dry run — npm publish <tarball> --dry-run')
  run('npm', ['publish', tarball, '--dry-run', '--access', 'public'])
} else {
  run('npm', ['publish', tarball, '--access', 'public'])
}

// 5. Verification is advisory: a landed upload must not turn this command red.
console.log('publish:release: verifying (advisory)')
try {
  run('node', ['scripts/post-publish-check.mjs', '--advisory'])
} catch {
  console.warn('publish:release: verification reported problems — run `npm run verify:publish` before trusting the release')
}
console.log('publish:release: done')
