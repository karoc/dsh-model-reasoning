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
 *     outcome. The "version document 404 while the package document is live"
 *     case is split by a TARBALL PRESENCE PROBE: a served tarball means the
 *     upload landed (benign index lag), a 404 tarball means the registry never
 *     created this version — npm exits 0 for an accepted-but-dropped publish
 *     (202 is < 400 for npm-registry-fetch), so the report must say "not on the
 *     registry, retry `npm publish`" instead of "the upload landed".
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
import { createHash, randomUUID } from 'node:crypto'
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

// `npm publish --dry-run` still runs `postpublish`; there is no upload to verify,
// and failing it turns a harmless dry run into a red npm invocation.
if (process.env.npm_config_dry_run === 'true' || process.env.npm_config_dry_run === '1') {
  console.log('post-publish-check: npm publish --dry-run — no upload to verify; skipping')
  console.log('post-publish-verdict: DRY_RUN')
  process.exit(0)
}

/** Parse a positive integer env seam, falling back to the production default. */
function positiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

const ATTEMPTS = positiveInt(process.env.DSH_POSTPUBLISH_ATTEMPTS, 20)
const INTERVAL_MS = positiveInt(process.env.DSH_POSTPUBLISH_INTERVAL_MS, 3000)
// A tarball 404 right after upload is registry/CDN propagation, not proof the
// upload was dropped: on 2026-10-31, 0.5.0 was visible with `latest` moved while
// the tarball still answered 404; the same URL served fine minutes later.
const TARBALL_PROPAGATION_ATTEMPTS = positiveInt(process.env.DSH_POSTPUBLISH_TARBALL_ATTEMPTS, 8)
const TARBALL_PROPAGATION_INTERVAL_MS = positiveInt(process.env.DSH_POSTPUBLISH_TARBALL_INTERVAL_MS, 5_000)
// Registry 404s are negatively cached (~300 s on npm's CDN). A unique query
// string is the only reliable cache bypass, so every retry after the first adds
// `?cb=<nonce>`; a canonical-URL 404 alone never proves absence.
const NONCE = () => `cb=${randomUUID()}`
const TAG_ATTEMPTS = Math.min(ATTEMPTS, 10)
const TARBALL_TIMEOUT_MS = positiveInt(process.env.DSH_POSTPUBLISH_TARBALL_TIMEOUT_MS, 20000)
const MAX_BUFFER = 8 * 1024 * 1024
// Hard wall-clock budget for the whole verification: propagation polling must
// never park `npm publish` for half an hour on a slow/unreachable registry.
const WALL_CLOCK_BUDGET_MS = positiveInt(process.env.DSH_POSTPUBLISH_BUDGET_MS, 3 * 60_000)
const STARTED_AT = Date.now()
const elapsedMs = () => Date.now() - STARTED_AT
const overBudget = () => elapsedMs() > WALL_CLOCK_BUDGET_MS
const STRICT = process.argv.includes('--strict')
// Lifecycle-hook mode: npm forwards `postpublish`'s exit code and suppresses the
// `+ pkg@ver` success line when it is nonzero, so a landed upload could look
// failed and invite a duplicate publish. In this mode problems are reported but
// the process exits 0; a separate `verify:publish --strict` owns the gate.
const ADVISORY = process.argv.includes('--advisory')

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
/** Redact `user:pass@` from a URL before logging it. */
function redactUrl(value) {
  return String(value).replace(/\/\/[^/@\s]+@/, '//***@')
}

console.log(`post-publish-check: registry ${redactUrl(registry.base)} (source: ${registry.source})`)
if (registry.source === 'DSH_POSTPUBLISH_REGISTRY_BASE' || registry.source === 'npm_config_registry') {
  console.log(`post-publish-check: ⚠️  not the default registry — verifying against an override`)
}

/**
 * The proxy npm itself would use, as an environment overlay for CHILD transports.
 *
 * Node's fetch ignores npm's `.npmrc` proxy settings, and the proxy variables
 * plus `NODE_USE_ENV_PROXY` are sampled when the process starts (verified on
 * Node 24.18: setting them inside the script changes nothing), so the
 * in-process fetch below goes DIRECT. On a network where the registry is only
 * reachable through a proxy every probe then degrades to `unknown` and this
 * check silently verifies nothing — the curl fallbacks are child processes, so
 * they DO inherit this overlay and keep working. `NO_PROXY` always keeps
 * loopback direct (the offline fixtures' stub registry lives there).
 * @returns an env overlay, empty when npm has no proxy configured.
 */
function npmProxyEnv() {
  const overlay = {}
  // ONE npm spawn, not two per config key: every npm invocation runs its log
  // cleaner (logs-max=10 by default), so the old probe destroyed the publish
  // forensics it was invoked to verify. `npm_config_logs_max` is raised for the
  // child and the whole config is read in a single call.
  let configJson
  try {
    configJson = JSON.parse(execSync('npm config list --json', {
      cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, npm_config_logs_max: '100' },
    }))
  } catch { /* npm unavailable: no overlay */ }
  for (const [envKey, configKey] of [['HTTPS_PROXY', 'https-proxy'], ['HTTP_PROXY', 'proxy']]) {
    let configured = ''
    const value = configJson?.[configKey]
    if (typeof value === 'string' && value !== 'null' && value !== 'undefined') configured = value
    if (configured === '') continue
    // npm's configured proxy WINS over an inherited variable: this check must
    // use the same transport as the `npm publish` it verifies. An inherited
    // variable that differs (e.g. the desktop shell's own forward proxy, which
    // does not route registry.npmjs.org) would otherwise take precedence for
    // the curl children and silently break them.
    const inherited = process.env[envKey] ?? ''
    if (inherited !== '' && inherited !== configured) {
      console.log(`post-publish-check: note — ${envKey}=${redactUrl(inherited)} is overridden by npm's configured proxy for the curl fallbacks`)
    }
    overlay[envKey] = configured
  }
  if (Object.keys(overlay).length === 0) return {}
  const noProxy = (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
    .split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
  for (const host of ['127.0.0.1', 'localhost', '::1']) if (!noProxy.includes(host)) noProxy.push(host)
  overlay.NO_PROXY = noProxy.join(',')
  return overlay
}

const proxyEnv = npmProxyEnv()
if (Object.keys(proxyEnv).length > 0) {
  console.log(`post-publish-check: proxy ${redactUrl(proxyEnv.HTTPS_PROXY ?? proxyEnv.HTTP_PROXY)} (from npm config; used by the curl fallbacks)`)
}

/** Registry JSON probe through curl — a child process, so the proxy overlay applies. */
function curlProbe(path, timeoutMs) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-postpublish-'))
  const body = join(dir, 'body.json')
  try {
    const result = spawnSync(
      'curl',
      ['-sS', '-o', body, '-w', '%{http_code}', '--max-time', String(Math.ceil(timeoutMs / 1000)), `${registry.base}/${path}`],
      { maxBuffer: MAX_BUFFER, env: { ...process.env, ...proxyEnv } },
    )
    if (result.error?.code === 'ENOENT' || result.status === 127) return { kind: 'no-curl' }
    if (result.status !== 0) return { kind: 'unknown', error: new Error(`curl exited ${result.status}`) }
    const status = Number.parseInt(String(result.stdout ?? '').trim(), 10)
    if (status === 404) return { kind: 'absent' }
    if (!(status >= 200 && status < 300)) return { kind: 'unknown', error: new Error(`HTTP ${status}`) }
    return { kind: 'data', doc: JSON.parse(readFileSync(body, 'utf8')) }
  } catch (error) {
    return { kind: 'unknown', error }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Three-state registry probe (D19/D25). Falls back to curl when a proxy is configured. */
async function probe(path, timeoutMs = 8000) {
  try {
    const response = await fetch(`${registry.base}/${path}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (response.status === 404) return { kind: 'absent' }
    if (!response.ok) return { kind: 'unknown', error: new Error(`HTTP ${response.status}`) }
    return { kind: 'data', doc: await response.json() }
  } catch (error) {
    // The in-process fetch cannot use npm's proxy (see npmProxyEnv); a
    // configured proxy means curl is the only transport that can reach the
    // registry here, so try it before reporting the probe as unknown.
    if (Object.keys(proxyEnv).length > 0) {
      const viaCurl = curlProbe(path, timeoutMs)
      if (viaCurl.kind !== 'no-curl') return viaCurl
    }
    return { kind: 'unknown', error }
  }
}

/** Curl status probe for a tarball URL (child process, so the proxy overlay applies). */
function curlTarballStatus(url, timeoutMs) {
  try {
    const result = spawnSync(
      'curl',
      ['-sS', '-I', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', String(Math.ceil(timeoutMs / 1000)), url],
      { maxBuffer: MAX_BUFFER, env: { ...process.env, ...proxyEnv } },
    )
    if (result.error?.code === 'ENOENT' || result.status === 127) return { kind: 'unknown', error: new Error('curl is unavailable') }
    const status = Number.parseInt(String(result.stdout ?? '').trim(), 10)
    if (!Number.isFinite(status)) return { kind: 'unknown', error: new Error(`curl exited ${result.status}`) }
    return interpretTarballStatus(status)
  } catch (error) {
    return { kind: 'unknown', error }
  }
}

/** Grade one HTTP status into tarball presence. */
function interpretTarballStatus(status) {
  if (status === 404 || status === 410) return { kind: 'absent' }
  if (status >= 200 && status < 300) return { kind: 'present' }
  return { kind: 'unknown', error: new Error(`HTTP ${status}`) }
}

/**
 * Does the registry serve this exact version's tarball?
 *
 * This is the discriminator the version document cannot provide: npm's publish
 * PUT succeeds on ANY status below 400 (`npm-registry-fetch` only throws on
 * >= 400), so a registry that answers `202 Accepted` makes `npm publish` print
 * success and exit 0 while creating nothing — the version document then 404s
 * for a reason that has NOTHING to do with index lag, and claiming "the upload
 * landed" hides a release that must be retried (live incident: 0.4.7,
 * 2026-09-30). The tarball URL is deterministic (`/<name>/-/<basename>-<v>.tgz`)
 * precisely when the version document is missing, so it is probed directly.
 *
 * @param url - absolute tarball URL.
 * @param timeoutMs - per-attempt bound.
 * @returns `present`, `absent`, or `unknown` (never fatal on transport).
 */
async function probeTarballPresence(url, timeoutMs = 10000) {
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) })
    // Some CDNs reject HEAD; a one-byte ranged GET is the portable fallback.
    if (head.status === 405 || head.status === 501) {
      const ranged = await fetch(url, { headers: { range: 'bytes=0-0' }, signal: AbortSignal.timeout(timeoutMs) })
      return interpretTarballStatus(ranged.status)
    }
    return interpretTarballStatus(head.status)
  } catch (error) {
    if (Object.keys(proxyEnv).length > 0) {
      const viaCurl = curlTarballStatus(url, timeoutMs)
      if (viaCurl.kind !== 'unknown' || viaCurl.error?.message !== 'curl is unavailable') return viaCurl
    }
    return { kind: 'unknown', error }
  }
}

// 1. Poll the version document. A definite 404 is remembered separately from
//    probe failures: only "both the version and the package document answered a
//    definite 404" may fail the run.
let visible = false
let sawVersionAbsent = false
let versionDoc
for (let attempt = 0; attempt <= ATTEMPTS && !visible && !overBudget(); attempt += 1) {
  if (attempt > 0) {
    if (attempt === 1 || attempt % 10 === 0 || attempt === ATTEMPTS) {
      console.log(`   (version not visible yet — registry index catching up; retry ${attempt}/${ATTEMPTS})`)
    }
    await sleep(INTERVAL_MS)
  }
  const result = await probe(`${encodedName}/${encodedVersion}${attempt > 0 ? `?${NONCE()}` : ''}`)
  const docName = result.kind === 'data' ? result.doc?.name : undefined
  const docVersion = result.kind === 'data' ? result.doc?.version : undefined
  const identityOk = result.kind === 'data' && docVersion === version
    && (typeof docName !== 'string' || docName === name)
  if (identityOk) {
    visible = true
    // Keep the document from the polling round: re-probing later would add a
    // second "unknown" failure mode before the tarball checks.
    versionDoc = result.doc
  } else if (result.kind === 'data') {
    // A registry/mirror answering a DIFFERENT document for this URL must not be
    // accepted as proof of our release (integrity checks would run against it).
    warnings.push(`the registry returned document ${JSON.stringify({ name: docName, version: docVersion })} for ${name}@${version} — identity mismatch; refusing to treat it as this release`)
  } else if (result.kind === 'absent') {
    sawVersionAbsent = true
  }
}

const packageProbe = await probe(encodedName)
// A 404 only means "not uploaded" if the registry is actually reachable: a
// proxy/mirror can answer 404 HTML for everything. `/-/ping` is the control.
const controlProbe = await probe('-/ping')
if (visible) {
  console.log(`✅ version ${version} is visible on the registry`)
} else if (sawVersionAbsent && packageProbe.kind === 'absent' && controlProbe.kind === 'data') {
  // A cached 404 is not proof of absence: re-probe both documents with a cache
  // bypass before claiming the upload never landed.
  const nonce = NONCE()
  const versionFresh = await probe(`${encodedName}/${encodedVersion}?${nonce}`)
  const packageFresh = await probe(`${encodedName}?${nonce}`)
  if (versionFresh.kind === 'absent' && packageFresh.kind === 'absent') {
    problems.push(
      `${name}@${version} answered a cache-bypassed 404 for both the version and the package document `
      + `after ~${Math.round((ATTEMPTS * INTERVAL_MS) / 1000)}s of polling while /-/ping answered 200 — the upload did not land`,
    )
  } else {
    warnings.push('uncached probes disagree with the cached 404s — the registry index is propagating; re-run this check later')
  }
} else {
  // Index lag, an unreadable probe, or a package that exists without this
  // version yet: none of these may fail an already-uploaded release. What they
  // must NOT do is claim the upload landed — the version document is missing,
  // so the tarball is probed as the discriminator (a 202 Accepted publish makes
  // npm exit 0 without creating anything).
  const observed = packageProbe.kind === 'data' && typeof packageProbe.doc?.['dist-tags']?.latest === 'string'
    ? packageProbe.doc['dist-tags'].latest
    : undefined
  // Unscoped names have no `%2F`; scoped ones keep only the basename in the
  // tarball filename (`@scope/pkg` → `pkg-<version>.tgz`).
  const separator = encodedName.lastIndexOf('%2F')
  const basename = separator < 0 ? encodedName : encodedName.slice(separator + 3)
  const tarballUrl = `${registry.base}/${encodedName}/-/${basename}-${encodedVersion}.tgz`
  let presence = sawVersionAbsent && packageProbe.kind === 'data'
    ? await probeTarballPresence(tarballUrl)
    : { kind: 'unknown', error: new Error('the package document is not readable, so absence is unproven') }
  if (presence.kind === 'absent') {
    const fresh = await probeTarballPresence(`${tarballUrl}?${NONCE()}`)
    if (fresh.kind !== 'absent') presence = fresh
  }
  const latestNote = observed === undefined ? '' : `, latest ${observed}`

  if (presence.kind === 'absent') {
    warnings.push(
      `version ${version} is not served by the registry yet after ~${Math.round((ATTEMPTS * INTERVAL_MS) / 1000)}s: `
      + `the version document and its tarball (${tarballUrl}) both answer 404 `
      + `while the package document is live${latestNote}. npm reported the publish as successful because the registry `
      + 'answered 202 Accepted, which npm treats as success (npm-registry-fetch only fails on >= 400). '
      + 'This state is AMBIGUOUS: a 202 publish can materialize long after the upload (measured in this repo: 0.4.7 was '
      + 'still 404 twenty minutes after the publish and was live, with `latest` moved, on a later re-run), and it can '
      + 'also have been dropped. Re-run this script later — do NOT re-publish while the version is merely unserved; '
      + 'if it is still absent much later, `npm publish` again (a duplicate of an accepted upload fails with '
      + 'EPUBLISHCONFLICT, which is the safe outcome).',
    )
  } else {
    warnings.push(
      `version ${version} is not indexed yet after ~${Math.round((ATTEMPTS * INTERVAL_MS) / 1000)}s`
      + (packageProbe.kind === 'data'
        ? ` (the package document is live${latestNote}, and ${presence.kind === 'present'
          ? 'the version tarball is served, so this release materialized (content not verified in this branch)'
          : 'the tarball probe was inconclusive'}) — the index is still catching up`
        : ' (the package document could not be read either — probe failures are not treated as absence)'),
    )
  }
  console.log(`   (version document: 404; tarball ${tarballUrl} → ${presence.kind})`)
}

// 2. dist-tags are ADVISORY (D11): npm itself refuses to publish a lower
//    version under the default `latest` tag, so after a successful upload a
//    mismatch can only be tag-propagation lag — never a failed publish.
if (visible) {
  let latest
  let taggedExactly = false
  for (let attempt = 0; attempt <= TAG_ATTEMPTS && !overBudget(); attempt += 1) {
    if (attempt > 0) {
      if (attempt === 1 || attempt % 10 === 0) {
        console.log(`   (dist-tag "latest" not yet ${version} — tag update catching up; retry ${attempt}/${TAG_ATTEMPTS})`)
      }
      await sleep(INTERVAL_MS)
    }
    const result = await probe(encodedName)
    if (result.kind === 'data') {
      const tags = result.doc?.['dist-tags'] ?? {}
      latest = typeof tags.latest === 'string' ? tags.latest : undefined
      taggedExactly = Object.values(tags).some(tag => tag === version)
      if (taggedExactly) break
    }
  }
  if (taggedExactly) {
    console.log(latest === version
      ? '✅ dist-tags.latest matches the published version'
      : `✅ a dist-tag points at ${version} (latest is ${latest ?? 'unreadable'}; prerelease or explicit --tag publish)`)
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
  const files = Array.isArray(manifest.files) ? manifest.files.filter((entry) => typeof entry === 'string' && !entry.startsWith('!')) : []
  const entries = files.map((entry) => entry.replace(/^\.\//, ''))
  if (!entries.includes('package.json')) entries.push('package.json')
  return entries
}

function listingHasEntry(listing, entry) {
  if (entry.includes('*')) {
    const prefix = entry.slice(0, entry.indexOf('*')).replace(/\/$/, '')
    return prefix === '' ? true : listing.some((line) => line.startsWith(`package/${prefix}`))
  }
  // npm `files` accepts a directory without the trailing slash: `lib` must
  // match `package/lib/index.js`, not demand a literal `package/lib` entry.
  return listing.includes(`package/${entry}`) || listing.some((line) => line.startsWith(`package/${entry}/`))
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
      ['-fsSL', '--proto', '=https,http', '--max-redirs', '3', '-o', body, '-w', '%{http_code}', '--max-time', String(Math.ceil(TARBALL_TIMEOUT_MS / 1000)), '--', url],
      { maxBuffer: MAX_BUFFER, env: { ...process.env, ...proxyEnv } },
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

/**
 * Obtain the tarball bytes with a bounded, uniform policy: two attempts, each
 * falling back to curl when the fetch failed at the transport layer (proxy-only
 * networks honor proxy variables in curl but not in node's fetch). Any
 * answered-but-unusable response — 4xx, 5xx, 407, non-gzip — is retried once,
 * matching the graded policy. Returns the last outcome when all attempts fail.
 */
async function obtainTarball(url) {
  let last
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let download = await downloadTarball(url)
    if (download.kind === 'transport') download = curlTarball(url)
    if (download.kind === 'ok') return download
    last = download
  }
  return last
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

/**
 * Trust only http(s) tarball URLs on the registry's own origin (cross-origin
 * redirects/URLs are how a mirror or compromised metadata could hand us bytes
 * from somewhere else; an explicit env opt-out exists for CDN-fronted mirrors).
 * @param value - candidate URL from dist.tarball.
 * @returns a rejection reason, or undefined when the URL is acceptable.
 */
function tarballUrlProblem(value) {
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    return 'the registry tarball URL is not a valid URL'
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `the registry tarball URL uses unsupported protocol ${parsed.protocol}`
  }
  const registryOrigin = new URL(registry.base).origin
  if (process.env.DSH_POSTPUBLISH_ALLOW_CROSS_ORIGIN_TARBALL !== '1' && parsed.origin !== registryOrigin) {
    return `the registry tarball host ${parsed.origin} differs from the registry origin ${registryOrigin} (set DSH_POSTPUBLISH_ALLOW_CROSS_ORIGIN_TARBALL=1 for CDN-fronted mirrors)`
  }
  return undefined
}

/**
 * Bind the served bytes to the publish via dist.integrity (sha512) or the
 * legacy dist.shasum (sha1). A mismatch is FATAL: same-filename substitution is
 * exactly what this check exists to catch.
 * @param doc - version document carrying dist.integrity/shasum.
 * @param buffer - downloaded tarball bytes.
 * @returns `{ok:true}` / `{ok:false, reason}` / `{ok:true, unverified:true}`.
 */
function verifyIntegrity(doc, buffer) {
  const integrity = doc?.dist?.integrity
  if (typeof integrity === 'string' && /^sha512-[A-Za-z0-9+/=]+$/.test(integrity)) {
    const expected = integrity.slice('sha512-'.length)
    const actual = createHash('sha512').update(buffer).digest('base64')
    return actual === expected ? { ok: true } : { ok: false, reason: `sha512 ${actual.slice(0, 16)}… != dist.integrity ${expected.slice(0, 16)}…` }
  }
  const shasum = doc?.dist?.shasum
  if (typeof shasum === 'string' && /^[0-9a-f]{40}$/.test(shasum)) {
    const actual = createHash('sha1').update(buffer).digest('hex')
    return actual === shasum ? { ok: true } : { ok: false, reason: `sha1 ${actual.slice(0, 16)}… != dist.shasum ${shasum.slice(0, 16)}…` }
  }
  return { ok: true, unverified: true }
}

if (visible) {
  const tarballUrl = versionDoc?.dist?.tarball
  if (typeof tarballUrl !== 'string' || tarballUrl === '') {
    warnings.push('the registry returned no tarball URL — tarball contents were not verified; re-run this script later')
  } else {
    const urlProblem = tarballUrlProblem(tarballUrl)
    if (urlProblem !== undefined) {
      problems.push(urlProblem)
    } else {
    let download = await obtainTarball(tarballUrl)
    for (let attempt = 1; attempt <= TARBALL_PROPAGATION_ATTEMPTS && !overBudget()
      && download.kind === 'http' && (download.status === 404 || download.status === 410); attempt += 1) {
      console.log(`   (tarball not served yet — registry/CDN propagation; retry ${attempt}/${TARBALL_PROPAGATION_ATTEMPTS})`)
      await sleep(TARBALL_PROPAGATION_INTERVAL_MS)
      download = await obtainTarball(`${tarballUrl}?${NONCE()}`)
    }
    const grade = download.kind === 'ok' ? { fatal: false } : gradeDownloadFailure(download)

    if (download.kind !== 'ok') {
      const propagating = download.kind === 'http' && (download.status === 404 || download.status === 410)
      if (propagating) {
        warnings.push(
          `the tarball is still not served after ~${Math.round((TARBALL_PROPAGATION_ATTEMPTS * TARBALL_PROPAGATION_INTERVAL_MS) / 1000)}s `
          + `(HTTP ${download.status}) while version ${version} is visible. `
          + 'The upload is evidenced by the registry documents, but the served bytes are NOT verified '
          + '(status: PENDING_PROPAGATION). Do NOT re-publish; re-run this check later.',
        )
      } else if (grade.fatal) problems.push(`could not verify the published tarball: ${grade.reason}`)
      else warnings.push(`could not verify the published tarball: ${grade.reason} — re-run this script once the network recovers`)
    } else {
      const buffer = download.buffer
      const integrity = verifyIntegrity(versionDoc, buffer)
      if (integrity.ok !== true) {
        problems.push(`the published tarball does not match dist.integrity: ${integrity.reason}`)
      } else if (integrity.unverified === true) {
        warnings.push('the version document carries no dist.integrity/shasum — served bytes could not be bound to the publish')
      } else {
        console.log('✅ published tarball sha512 matches dist.integrity')
      }
      let listing
      try {
        listing = execSync('tar -tzf -', {
          cwd: root, encoding: 'utf8', timeout: 25000, maxBuffer: MAX_BUFFER, input: buffer,
        }).split('\n').filter((line) => line.trim() !== '')
      } catch (error) {
        // The body arrived complete (2xx) but is not a readable tar stream:
        // that is a corrupt artifact, not a transport failure.
        problems.push(`the published tarball is not a readable tar archive: ${firstLine(error.message)}`)
      }
      if (listing !== undefined) {
        const expected = expectedEntries(pkg)
        const missing = expected.filter((entry) => !listingHasEntry(listing, entry))
        if (listing.length === 0) problems.push('the published tarball listing is empty')
        else if (missing.length > 0) problems.push(`the published tarball is missing: ${missing.join(', ')}`)
        else console.log(`✅ published tarball contains all ${expected.length} expected entries`)
        const allowedExtra = /(^package\/(package\.json|README(\.[^/]*)?|LICEN[SC]E(\.[^/]*)?|CHANGELOG(\.[^/]*)?|npmignore|\.npmignore)$)/
        const extra = listing.filter((line) => {
          const rel = line.replace(/^package\//, '')
          if (rel === '' || line.endsWith('/')) return false
          if (allowedExtra.test(line)) return false
          return !expected.some((entry) => rel === entry || rel.startsWith(`${entry}/`) || (entry.includes('*') && rel.startsWith(entry.slice(0, entry.indexOf('*')))))
        })
        if (extra.length > 0) warnings.push(`the tarball ships ${extra.length} unexpected entr${extra.length === 1 ? 'y' : 'ies'} (e.g. ${extra.slice(0, 3).join(', ')}) — check the files whitelist`)

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
}

const definiteAbsence = problems.some((problem) => problem.includes('definite 404'))
const verdict = problems.length > 0
  ? (definiteAbsence ? 'NOT_PUBLISHED' : 'CONTENT_MISMATCH')
  : warnings.length > 0 ? 'PENDING_PROPAGATION' : 'CONFIRMED'
console.log(`post-publish-verdict: ${verdict}`)

if (problems.length > 0) {
  console.error('\n❌ post-publish-check FAILED:')
  for (const problem of problems) console.error(`   - ${problem}`)
  console.error(`\n   ${name}@${version} may or may not be live — verify before re-publishing:`)
  console.error(`   node ${join('scripts', 'post-publish-check.mjs')}  (re-runs these checks)`)
  if (ADVISORY) {
    console.log('post-publish-check: ADVISORY mode (npm lifecycle hook) — reporting only, exiting 0')
    process.exit(0)
  }
  process.exit(1)
}

if (warnings.length > 0) {
  console.log('\n⚠️  post-publish-check passed with warnings (none of these fail an uploaded release):')
  for (const warning of warnings) console.log(`   - ${warning}`)
  console.log(`\n   Re-run to complete the checks once the index catches up:`)
  console.log(`   node ${join('scripts', 'post-publish-check.mjs')}`)
  // --strict is for CI: PENDING_PROPAGATION is not a green state for a gate.
  process.exit(STRICT ? 3 : 0)
}

console.log('\n✅ post-publish-check passed: release is live and consistent on npm.')
