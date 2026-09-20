#!/usr/bin/env node
/**
 * Offline fixture for `post-publish-check.mjs` (frozen plan v6, L6).
 *
 * Spins a local stub registry, lays out a throwaway package tree, and asserts
 * the exit code plus the key output lines of every grading branch:
 *
 *   1. normal              → exit 0 (version visible, tag matches, tarball ok)
 *   2. index lag           → exit 0 (version unindexed, package live, re-run hint)
 *   3. definite 404        → exit 1 (version and package document both absent)
 *   4. tag lags behind     → exit 0 (advisory warning only)
 *   5. tag ahead           → exit 0 (advisory warning only)
 *   6. tarball HTTP 404    → exit 1 after one retry
 *   7. tarball not gzip    → exit 1
 *   8. listing misses file → exit 1
 *   9. registry unreachable→ exit 0 (transport failures never fail a release)
 *  10. tarball 503         → exit 0 (answered but unusable, retried once)
 *  11. tarball 407         → exit 0 (proxy refusal, retried once)
 *  12. tarball 403         → exit 1 (retried once, then fatal)
 *  13. truncated gzip      → exit 0 (unreadable tar stream = transport)
 *  14. hanging endpoint    → exit 0 (fetch timeout + curl fallback)
 *  15. no tarball URL      → exit 0 with a re-run instruction
 *
 * Run with `node scripts/test-post-publish.mjs` (no network, a few seconds).
 */
import { execSync, spawn } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'post-publish-check.mjs')
const version = '1.2.3'
const files = ['lib/index.js', 'cordis.patch.yml', 'README.md', 'LICENSE']
const libBody = 'module.exports = {}\n// fixture artifact\n'

const work = mkdtempSync(join(tmpdir(), 'dsh-postpublish-fixture-'))
const pkgRoot = join(work, 'pkg')
const scriptsDir = join(pkgRoot, 'scripts')
mkdirSync(join(pkgRoot, 'lib'), { recursive: true })
mkdirSync(scriptsDir, { recursive: true })
cpSync(source, join(scriptsDir, 'post-publish-check.mjs'))
writeFileSync(join(pkgRoot, 'lib/index.js'), libBody)
writeFileSync(join(pkgRoot, 'cordis.patch.yml'), '[]\n')
writeFileSync(join(pkgRoot, 'README.md'), '# fixture\n')
writeFileSync(join(pkgRoot, 'LICENSE'), 'MIT\n')
writeFileSync(join(pkgRoot, 'package.json'), `${JSON.stringify({
  name: 'fixture-pkg',
  version,
  files,
}, null, 2)}\n`)

/** Build a tarball containing `package/<entries>` and return its bytes. */
function buildTarball(entries) {
  const staging = mkdtempSync(join(tmpdir(), 'dsh-postpublish-stage-'))
  for (const entry of entries) {
    const target = join(staging, 'package', entry)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry === 'lib/index.js' ? libBody : `${entry}\n`)
  }
  const out = join(staging, 'bundle.tgz')
  execSync(`tar -czf ${JSON.stringify(out)} -C ${JSON.stringify(join(staging, 'package'))} .`, { stdio: 'ignore' })
  const bytes = readFileSync(out)
  rmSync(staging, { recursive: true, force: true })
  // `tar -C dir .` yields paths like ./lib/index.js; rebuild with a package/
  // prefix so the fixture mirrors a real npm tarball.
  const prefixed = execSync('tar -tzf -', { input: bytes, encoding: 'utf8' })
  if (prefixed.includes('package/')) return bytes
  const restage = mkdtempSync(join(tmpdir(), 'dsh-postpublish-stage-'))
  for (const entry of entries) {
    const target = join(restage, 'package', entry)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry === 'lib/index.js' ? libBody : `${entry}\n`)
  }
  const reout = join(restage, 'bundle.tgz')
  execSync(`tar -czf ${JSON.stringify(reout)} -C ${JSON.stringify(restage)} package`, { stdio: 'ignore' })
  const rebytes = readFileSync(reout)
  rmSync(restage, { recursive: true, force: true })
  return rebytes
}

const tarballs = {
  // npm always adds package.json (and README/LICENSE when present) on top of
  // `files`; the fixture mirrors that.
  ok: buildTarball([...files, 'package.json']),
  missing: buildTarball([...files.filter((entry) => entry !== 'cordis.patch.yml'), 'package.json']),
}

const state = {
  mode: 'normal',
  tag: version,
  versionVisible: true,
  packageVisible: true,
  omitTarball: false,
}

/** Per-scenario request counters (reset by the loop). */
const hits = { tarball: 0 }

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const path = decodeURIComponent(url.pathname)
  const packageDoc = () => ({
    name: 'fixture-pkg',
    'dist-tags': { latest: state.tag },
    versions: state.versionVisible
      ? {
          [version]: {
            name: 'fixture-pkg',
            version,
            ...(state.omitTarball ? {} : { dist: { tarball: `${base}/tarball/${state.mode}` } }),
          },
        }
      : {},
  })
  if (path === '/fixture-pkg') {
    if (!state.packageVisible) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"Not found"}')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(packageDoc()))
    return
  }
  if (path === `/fixture-pkg/${version}`) {
    if (!state.versionVisible) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end('{"error":"Not found"}')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      name: 'fixture-pkg',
      version,
      ...(state.omitTarball ? {} : { dist: { tarball: `${base}/tarball/${state.mode}` } }),
    }))
    return
  }
  if (path.startsWith('/tarball/')) {
    hits.tarball += 1
    const mode = path.slice('/tarball/'.length)
    if (mode === 'tarball-404') {
      response.writeHead(404, { 'content-type': 'text/html' })
      response.end('<!DOCTYPE html><title>Not Found</title>')
      return
    }
    if (mode === 'tarball-403' || mode === 'tarball-407' || mode === 'tarball-503') {
      response.writeHead(Number(mode.slice('tarball-'.length)), { 'content-type': 'text/plain' })
      response.end('upstream refused')
      return
    }
    if (mode === 'not-gzip') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end('this is not a gzip stream')
      return
    }
    if (mode === 'truncated') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(tarballs.ok.subarray(0, Math.floor(tarballs.ok.length / 2)))
      return
    }
    if (mode === 'hang') {
      // Accepts the connection and never answers: exercises the download timeout
      // and the curl fallback (both must be non-fatal).
      return
    }
    const bytes = mode === 'missing-entry' ? tarballs.missing : tarballs.ok
    response.writeHead(200, { 'content-type': 'application/octet-stream' })
    response.end(bytes)
    return
  }
  response.writeHead(404)
  response.end('nope')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

/**
 * Run the script under test in the fixture package with fast seams.
 * ASYNC on purpose: the stub registry lives on this process's event loop, so a
 * synchronous execSync here would deadlock (the parent could not answer the
 * child's probes).
 */
function runCheck(overrides = {}) {
  // The fixture only talks to the local stub: strip proxy variables so an
  // ambient HTTP(S)_PROXY / NODE_USE_ENV_PROXY cannot reroute loopback traffic.
  const childEnv = { ...process.env }
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    delete childEnv[key]
  }
  childEnv.NO_PROXY = '127.0.0.1,localhost'
  childEnv.no_proxy = '127.0.0.1,localhost'
  Object.assign(childEnv, {
    DSH_POSTPUBLISH_REGISTRY_BASE: overrides.registry ?? base,
    DSH_POSTPUBLISH_ATTEMPTS: '2',
    DSH_POSTPUBLISH_INTERVAL_MS: '50',
    DSH_POSTPUBLISH_TARBALL_TIMEOUT_MS: '800',
  })
  return new Promise((resolve) => {
    const child = spawn('node', [join(scriptsDir, 'post-publish-check.mjs')], { cwd: pkgRoot, env: childEnv })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.stderr.on('data', (chunk) => { output += String(chunk) })
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
    child.on('error', (error) => resolve({ code: 1, output: `${output}\nspawn error: ${error.message}` }))
  })
}

async function runCheckAllowingFailure(overrides = {}) {
  return runCheck(overrides)
}

const scenarios = [
  {
    name: 'normal',
    setup: () => Object.assign(state, { mode: 'normal', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0
      && result.output.includes(`version ${version} is visible on the registry`)
      && result.output.includes('dist-tags.latest matches the published version')
      && result.output.includes('published tarball contains all')
      && result.output.includes('published lib/index.js matches this tree')
      && result.output.includes('release is live and consistent'),
  },
  {
    name: 'index lag (version unindexed, package live)',
    setup: () => Object.assign(state, { mode: 'normal', tag: version, versionVisible: false, packageVisible: true }),
    expect: (result) => result.code === 0
      && result.output.includes('is not indexed yet')
      && result.output.includes('Re-run to complete the checks'),
  },
  {
    name: 'definite 404 for version and package',
    setup: () => Object.assign(state, { mode: 'normal', versionVisible: false, packageVisible: false }),
    expect: (result) => result.code === 1 && result.output.includes('definite 404'),
  },
  {
    name: 'tag lags behind',
    setup: () => Object.assign(state, { mode: 'normal', tag: '1.2.2', versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0 && result.output.includes('lower than this release'),
  },
  {
    name: 'tag ahead',
    setup: () => Object.assign(state, { mode: 'normal', tag: '9.9.9', versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0 && result.output.includes('higher than this release'),
  },
  {
    name: 'tarball HTTP 404',
    setup: () => Object.assign(state, { mode: 'tarball-404', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 1 && result.output.includes('HTTP 404') && hits.tarball === 2,
  },
  {
    name: 'tarball not gzip',
    setup: () => Object.assign(state, { mode: 'not-gzip', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 1 && result.output.includes('not gzip'),
  },
  {
    name: 'listing misses a file',
    setup: () => Object.assign(state, { mode: 'missing-entry', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 1 && result.output.includes('is missing: cordis.patch.yml'),
  },
  {
    name: 'registry unreachable (transport)',
    setup: () => Object.assign(state, { mode: 'normal', versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0 && result.output.includes('is not indexed yet'),
  },
  {
    name: 'tarball 503 (answered, retried once, non-fatal)',
    setup: () => Object.assign(state, { mode: 'tarball-503', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0 && result.output.includes('HTTP 503') && hits.tarball === 2,
  },
  {
    // Node's fetch treats a 407 as a proxy challenge and throws, so this
    // scenario exercises fetch → curl fallback → second attempt (4 hits).
    // Assert a lower bound so the check survives Node changing that behavior.
    name: 'tarball 407 (answered, retried once, non-fatal)',
    setup: () => Object.assign(state, { mode: 'tarball-407', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0 && result.output.includes('HTTP 407') && hits.tarball >= 2,
  },
  {
    name: 'tarball 403 (answered, fatal)',
    setup: () => Object.assign(state, { mode: 'tarball-403', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 1 && result.output.includes('HTTP 403') && hits.tarball === 2,
  },
  {
    name: 'tarball truncated (gzip magic ok, stream broken, non-fatal)',
    setup: () => Object.assign(state, { mode: 'truncated', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0 && result.output.includes('could not list the published tarball') && hits.tarball === 1,
  },
  {
    name: 'tarball hangs (timeout + curl fallback, non-fatal)',
    setup: () => Object.assign(state, { mode: 'hang', tag: version, versionVisible: true, packageVisible: true }),
    expect: (result) => result.code === 0
      && result.output.includes('could not verify the published tarball')
      && hits.tarball >= 1,
  },
  {
    name: 'no tarball URL in the version document (non-fatal, re-run hint)',
    setup: () => {
      Object.assign(state, { mode: 'normal', tag: version, versionVisible: true, packageVisible: true })
      state.omitTarball = true
    },
    expect: (result) => result.code === 0
      && result.output.includes('no tarball URL')
      && result.output.includes('Re-run to complete the checks'),
  },
]

let failures = 0
try {
  for (const scenario of scenarios) {
    hits.tarball = 0
    state.omitTarball = false
    scenario.setup()
    const overrides = scenario.name.startsWith('registry unreachable')
      ? { registry: 'http://127.0.0.1:1' }
      : {}
    const result = await runCheckAllowingFailure(overrides)
    const ok = scenario.expect(result)
    console.log(`${ok ? '✔' : '✖'} ${scenario.name} (exit ${result.code}, tarball hits ${hits.tarball})`)
    if (!ok) {
      failures += 1
      console.log(result.output.split('\n').map((line) => `    | ${line}`).join('\n'))
    }
  }
} finally {
  // fetch keeps connections alive; without this the stub server never lets the
  // process exit even though every scenario finished.
  server.closeAllConnections?.()
  server.close()
  rmSync(work, { recursive: true, force: true })
}

if (failures > 0) {
  console.error(`\n❌ ${failures}/${scenarios.length} fixture scenarios failed`)
  process.exit(1)
}
console.log(`\n✅ post-publish-check fixture: ${scenarios.length}/${scenarios.length} scenarios passed`)
process.exit(0)
