#!/usr/bin/env node
/**
 * Post-publish verification, run by npm's `postpublish` lifecycle AFTER the
 * package has been uploaded.
 *
 * It CANNOT prevent a bad publish — the upload already happened. Its job is to
 * confirm the release actually landed, with a loud alarm only when something is
 * genuinely wrong. Because postpublish only runs after npm's upload PUT
 * succeeded, "the index has not caught up yet" must never be reported as a
 * failure: a false failure here made a successful 0.1.0 publish look broken on
 * 2026-09-19 (the version document only became visible ~4 minutes after the
 * upload; a 60s window gave up first).
 *
 * Grading rules (frozen remediation plan v6 §2):
 *   FATAL (exit 1):
 *     1. the tarball answers HTTP 404 / other 4xx (407 excepted) after one retry;
 *     2. the tarball body is not gzip after one retry;
 *     3. the listing (obtained with tar exit 0) is empty or misses an expected
 *        entry;
 *     4. the version document AND the package document both answer a definite
 *        404 after the polling budget.
 *   NON-FATAL (warn, exit 0):
 *     transport failures (DNS/connect/timeout/no curl), HTTP 5xx / 407,
 *     unavailable dist-tags, a `latest` tag that lags or points elsewhere, a
 *     lib/index.js checksum difference, and every "index still catching up"
 *     outcome.
 *
 * Registry resolution (B4): DSH_POSTPUBLISH_REGISTRY_BASE → npm_config_registry
 * → ./.npmrc → $NPM_CONFIG_USERCONFIG (or ~/.npmrc) → package.json
 * publishConfig.registry → https://registry.npmjs.org. The effective value and
 * its source are printed.
 *
 * Test seams (B7; production defaults unchanged when unset):
 *   DSH_POSTPUBLISH_REGISTRY_BASE, DSH_POSTPUBLISH_ATTEMPTS,
 *   DSH_POSTPUBLISH_INTERVAL_MS, DSH_POSTPUBLISH_TARBALL_TIMEOUT_MS.
 *
 * Like every lifecycle script, it is skipped by `npm publish --ignore-scripts`.
 */
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const firstLine = (text) => String(text ?? '').split('\n')[0]

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const { name, version } = pkg
const encodedName = encodeURIComponent(name)
const encodedVersion = encodeURIComponent(version)

const problems = []
const warnings = []

/** Parse a positive integer env seam, falling back to the production default. */
function positiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const ATTEMPTS = positiveInt(process.env.DSH_POSTPUBLISH_ATTEMPTS, 100)
const INTERVAL_MS = positiveInt(process.env.DSH_POSTPUBLISH_INTERVAL_MS, 3000)
const TAG_ATTEMPTS = Math.min(ATTEMPTS, 20)
const TARBALL_TIMEOUT_MS = positiveInt(process.env.DSH_POSTPUBLISH_TARBALL_TIMEOUT_MS, 20000)
const MAX_BUFFER = 8 * 1024 * 1024

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

/** Resolve the registry base URL and where it came from (B4). */
function resolveRegistry() {
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
  const declared = typeof pkg.publishConfig?.registry === 'string' ? pkg.publishConfig.registry.trim() : ''
  if (declared !== '') candidates.push([declared.replace(/\/+$/, ''), 'package.json publishConfig.registry'])
  const [base, source] = candidates[0] ?? ['https://registry.npmjs.org', 'default']
  return { base, source }
}

const registry = resolveRegistry()

console.log(`post-publish-check: ${name}@${version}`)
console.log(`post-publish-check: registry ${registry.base} (source: ${registry.source})`)
if (registry.source === 'DSH_POSTPUBLISH_REGISTRY_BASE' || registry.source === 'npm_config_registry') {
  console.log(`post-publish-check: ⚠️  not the default registry — verifying against an override`)
}

/** Three-state registry probe (D19/D25). */
async function probe(path, timeoutMs = 10000) {
  try {
    const response = await fetch(`${registry.base}/${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (response.status === 404) return { kind: 'absent' }
    if (!response.ok) return { kind: 'unknown', error: new Error(`HTTP ${response.status}`) }
    return { kind: 'data', doc: await response.json() }
  } catch (error) {
    return { kind: 'unknown', error }
  }
}

// 1. Poll the version document. A definite 404 is remembered separately from
//    probe failures: only "both the version and the package document answered a
//    definite 404" may fail the run.
let visible = false
let sawVersionAbsent = false
let versionDoc
for (let attempt = 0; attempt <= ATTEMPTS && !visible; attempt += 1) {
  if (attempt > 0) {
    if (attempt === 1 || attempt % 10 === 0 || attempt === ATTEMPTS) {
      console.log(`   (version not visible yet — registry index catching up; retry ${attempt}/${ATTEMPTS})`)
    }
    await sleep(INTERVAL_MS)
  }
  const result = await probe(`${encodedName}/${encodedVersion}`)
  if (result.kind === 'data' && typeof result.doc?.version === 'string') {
    visible = true
    // Keep the document from the polling round: re-probing later would add a
    // second "unknown" failure mode before the tarball checks.
    versionDoc = result.doc
  } else if (result.kind === 'absent') {
    sawVersionAbsent = true
  }
}

const packageProbe = await probe(encodedName)
if (visible) {
  console.log(`✅ version ${version} is visible on the registry`)
} else if (sawVersionAbsent && packageProbe.kind === 'absent') {
  problems.push(
    `${name}@${version} answered a definite 404 for both the version and the package document `
    + `after ~${Math.round((ATTEMPTS * INTERVAL_MS) / 1000)}s of polling — the upload did not land`,
  )
} else {
  // Index lag, an unreadable probe, or a package that exists without this
  // version yet: none of these may fail an already-uploaded release.
  const observed = packageProbe.kind === 'data' && typeof packageProbe.doc?.['dist-tags']?.latest === 'string'
    ? packageProbe.doc['dist-tags'].latest
    : undefined
  warnings.push(
    `version ${version} is not indexed yet after ~${Math.round((ATTEMPTS * INTERVAL_MS) / 1000)}s`
    + (packageProbe.kind === 'data'
      ? ` (the package document is live${observed === undefined ? '' : `, latest ${observed}`}) — the upload landed, the index is still catching up`
      : ' (the package document could not be read either — probe failures are not treated as absence)'),
  )
}

// 2. dist-tags are ADVISORY (D11): npm itself refuses to publish a lower
//    version under the default `latest` tag, so after a successful upload a
//    mismatch can only be tag-propagation lag — never a failed publish.
if (visible) {
  let latest
  for (let attempt = 0; attempt <= TAG_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      if (attempt === 1 || attempt % 10 === 0) {
        console.log(`   (dist-tag "latest" not yet ${version} — tag update catching up; retry ${attempt}/${TAG_ATTEMPTS})`)
      }
      await sleep(INTERVAL_MS)
    }
    const result = await probe(encodedName)
    if (result.kind === 'data') {
      const tag = result.doc?.['dist-tags']?.latest
      latest = typeof tag === 'string' ? tag : undefined
      if (latest === version) break
    }
  }
  if (latest === version) {
    console.log('✅ dist-tags.latest matches the published version')
  } else {
    warnings.push(`dist-tags.latest ${describeTag(latest, version)}`)
  }
}

/** Numeric x.y.z comparison; undefined when either side is not three-part. */
function compareVersions(left, right) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value))
    return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const a = parse(left)
  const b = parse(right)
  if (a === undefined || b === undefined) return undefined
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1
  }
  return 0
}

function describeTag(latest, expected) {
  if (latest === undefined) return `could not be read (expected ${expected}) — advisory only`
  const order = compareVersions(latest, expected)
  if (order === undefined) return `is "${latest}" (not x.y.z) while this release is ${expected} — advisory only`
  if (order < 0) return `is ${latest}, lower than this release (${expected}) — it may still be catching up; if it stays lower, users install ${latest}`
  if (order > 0) return `is ${latest}, higher than this release (${expected}) — a newer version exists`
  return `differs from this release (${expected}) — advisory only`
}

// 3. Tarball contents: httpx/gzip problems are graded, transport problems are
//    never fatal (the upload already succeeded), and a tar that cannot read the
//    stream counts as transport, not as a content mismatch.
function expectedEntries(manifest) {
  const files = Array.isArray(manifest.files) ? manifest.files.filter((entry) => typeof entry === 'string') : []
  const entries = files.map((entry) => entry.replace(/^\.\//, ''))
  if (!entries.includes('package.json')) entries.push('package.json')
  return entries
}

function listingHasEntry(listing, entry) {
  if (entry.includes('*')) {
    const prefix = entry.slice(0, entry.indexOf('*')).replace(/\/$/, '')
    return prefix === '' ? true : listing.some((line) => line.startsWith(`package/${prefix}`))
  }
  if (entry.endsWith('/')) {
    return listing.some((line) => line.startsWith(`package/${entry}`))
  }
  return listing.includes(`package/${entry}`)
}

async function downloadTarball(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TARBALL_TIMEOUT_MS) })
    if (!response.ok) return { kind: 'http', status: response.status }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) return { kind: 'not-gzip' }
    return { kind: 'ok', buffer }
  } catch (error) {
    return { kind: 'transport', error }
  }
}

function curlTarball(url) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-postpublish-'))
  const body = join(dir, 'body.tgz')
  try {
    const result = spawnSync(
      'curl',
      ['-fsS', '-o', body, '-w', '%{http_code}', '--max-time', String(Math.ceil(TARBALL_TIMEOUT_MS / 1000)), url],
      { maxBuffer: MAX_BUFFER },
    )
    if (result.error?.code === 'ENOENT' || result.status === 127) return { kind: 'no-curl' }
    const status = Number.parseInt(String(result.stdout ?? '').trim(), 10)
    if (result.status === 22) return { kind: 'http', status: Number.isFinite(status) ? status : 400 }
    if (result.status !== 0) {
      return { kind: 'transport', error: new Error(`curl exited ${result.status}${result.status === null ? ' (killed)' : ''}`) }
    }
    const buffer = readFileSync(body)
    if (buffer.length < 2 || buffer[0] !== 0x1f || buffer[1] !== 0x8b) return { kind: 'not-gzip' }
    return { kind: 'ok', buffer }
  } catch (error) {
    return { kind: 'transport', error }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Grade a failed download: only 4xx (407 excepted) and non-gzip are fatal. */
function gradeDownloadFailure(result) {
  if (result.kind === 'http') {
    const status = result.status
    if (status === 407 || (status >= 500 && status <= 599)) {
      return { fatal: false, reason: `HTTP ${status} from the registry/CDN` }
    }
    return { fatal: true, reason: `HTTP ${status} for the tarball` }
  }
  if (result.kind === 'not-gzip') return { fatal: true, reason: 'the tarball body is not gzip' }
  return {
    fatal: false,
    reason: result.kind === 'no-curl' ? 'curl is unavailable' : `transport failure (${firstLine(result.error?.message)})`,
  }
}

if (visible) {
  const tarballUrl = versionDoc?.dist?.tarball
  if (typeof tarballUrl !== 'string' || tarballUrl === '') {
    warnings.push('the registry returned no tarball URL — tarball contents were not verified; re-run this script later')
  } else {
    let download = await downloadTarball(tarballUrl)
    let grade = download.kind === 'ok' ? { fatal: false } : gradeDownloadFailure(download)
    if (download.kind === 'transport') {
      // curl honors proxy environment variables; node's fetch does not unless
      // NODE_USE_ENV_PROXY is set, so a proxy-only network falls back to curl.
      download = curlTarball(tarballUrl)
      grade = download.kind === 'ok' ? { fatal: false } : gradeDownloadFailure(download)
    } else if (download.kind !== 'ok') {
      // One retry for EVERY answered-but-unusable response (a CDN 5xx/407 blip
      // or a truncated body), matching the graded policy in the plan.
      download = await downloadTarball(tarballUrl)
      grade = download.kind === 'ok' ? { fatal: false } : gradeDownloadFailure(download)
    }

    if (download.kind !== 'ok') {
      if (grade.fatal) problems.push(`could not verify the published tarball: ${grade.reason}`)
      else warnings.push(`could not verify the published tarball: ${grade.reason} — re-run this script once the network recovers`)
    } else {
      const buffer = download.buffer
      let listing
      try {
        listing = execSync('tar -tzf -', {
          cwd: root, encoding: 'utf8', timeout: 25000, maxBuffer: MAX_BUFFER, input: buffer,
        }).split('\n').filter((line) => line.trim() !== '')
      } catch (error) {
        warnings.push(`could not list the published tarball (${firstLine(error.message)}) — treated as transport, not as a content mismatch`)
      }
      if (listing !== undefined) {
        const expected = expectedEntries(pkg)
        const missing = expected.filter((entry) => !listingHasEntry(listing, entry))
        if (listing.length === 0) problems.push('the published tarball listing is empty')
        else if (missing.length > 0) problems.push(`the published tarball is missing: ${missing.join(', ')}`)
        else console.log(`✅ published tarball contains all ${expected.length} expected entries`)

        const localLib = join(root, 'lib/index.js')
        if (existsSync(localLib) && listing.includes('package/lib/index.js')) {
          try {
            const published = execSync('tar -xzOf - package/lib/index.js', {
              cwd: root, maxBuffer: MAX_BUFFER, timeout: 25000, input: buffer,
            })
            const publishedHash = createHash('sha256').update(published).digest('hex')
            const localHash = createHash('sha256').update(readFileSync(localLib)).digest('hex')
            if (publishedHash === localHash) {
              console.log(`✅ published lib/index.js matches this tree (sha256 ${localHash.slice(0, 12)}…)`)
            } else {
              warnings.push(
                `published lib/index.js (sha256 ${publishedHash.slice(0, 12)}…) differs from this tree `
                + `(${localHash.slice(0, 12)}…) — expected when a tarball packed elsewhere was published`,
              )
            }
          } catch (error) {
            warnings.push(`could not compare lib/index.js checksums: ${firstLine(error.message)}`)
          }
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error('\n❌ post-publish-check FAILED:')
  for (const problem of problems) console.error(`   - ${problem}`)
  console.error(`\n   ${name}@${version} may or may not be live — verify before re-publishing:`)
  console.error(`   node ${join('scripts', 'post-publish-check.mjs')}  (re-runs these checks)`)
  process.exit(1)
}

if (warnings.length > 0) {
  console.log('\n⚠️  post-publish-check passed with warnings (none of these fail an uploaded release):')
  for (const warning of warnings) console.log(`   - ${warning}`)
  console.log(`\n   Re-run to complete the checks once the index catches up:`)
  console.log(`   node ${join('scripts', 'post-publish-check.mjs')}`)
  process.exit(0)
}

console.log('\n✅ post-publish-check passed: release is live and consistent on npm.')
