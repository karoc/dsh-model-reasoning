#!/usr/bin/env node
/**
 * Negative controls for this repo's gates: a gate nobody has seen FAIL is not
 * evidence. Every scenario below clones the committed tree into a temp dir,
 * injects ONE defect, runs the gate that is supposed to catch it, and asserts
 * the gate FAILS with the expected message. A scenario that passes (or that
 * fails for the wrong reason) fails this script.
 *
 * Why: a promise in docs/guarantees.md once passed for the wrong reason (a fixture
 * that could not trigger the guard), and manual one-off proofs decay — this
 * script re-proves the gates on every run.
 *
 * Offline-friendly: DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE=1 is set so the
 * release gate's registry probe cannot turn the positive control red.
 */
import { execFileSync, execSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const VERSION = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const TAG = `v${VERSION}`

/** Fresh clone of the committed tree, with the (gitignored) build output copied in. */
function freshClone() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-reasoning-control-'))
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', root, dir], { stdio: 'ignore' })
  if (!existsSync(join(root, 'lib/client.js'))) {
    console.error('❌ negative controls need a built artifact — run `npm run bundle` first')
    process.exit(1)
  }
  cpSync(join(root, 'lib'), join(dir, 'lib'), { recursive: true })
  return dir
}

/** Run a command inside the clone; never throws. */
function run(dir, command) {
  try {
    return { code: 0, output: execSync(command, { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE: '1' } }) }
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

const scenarios = [
  {
    name: 'dirty working tree',
    command: 'node scripts/release-check.mjs',
    expect: /working tree is not clean/,
    mutate: (dir) => appendFileSync(join(dir, 'README.md'), '\n<!-- uncommitted -->\n'),
  },
  {
    name: 'CHANGELOG entry for the current version removed',
    command: 'node scripts/release-check.mjs',
    expect: new RegExp(`CHANGELOG\\.md has no entry for \\[${VERSION.replace(/\./g, '\\.')}\\]`),
    mutate: (dir) => {
      const p = join(dir, 'CHANGELOG.md')
      writeFileSync(p, readFileSync(p, 'utf8').replace(new RegExp(`^## \\[${VERSION.replace(/\./g, '\\.')}\\].*$`, 'm'), ''))
    },
  },
  {
    name: 'release tag deleted',
    command: 'node scripts/release-check.mjs',
    expect: new RegExp(`git tag ${TAG} does not exist`),
    mutate: (dir) => execFileSync('git', ['tag', '-d', TAG], { cwd: dir, stdio: 'ignore' }),
  },
  {
    name: 'build artifact removed',
    command: 'node scripts/release-check.mjs',
    expect: /is missing — run `npm run bundle` first/,
    mutate: (dir) => rmSync(join(dir, 'lib/client.js')),
  },
  {
    name: 'guarantee row loses its pinning assertion',
    command: 'node scripts/check-guarantees.mjs',
    expect: /no test title matches/,
    mutate: (dir) => {
      const p = join(dir, 'docs/guarantees.md')
      writeFileSync(p, readFileSync(p, 'utf8').replace(/`emits nothing for a no-diff draft`/, '`an assertion that does not exist`'))
    },
  },
]

let failed = 0
console.log('▶ positive control — an unmutated clone must PASS both gates')
{
  const dir = freshClone()
  const release = run(dir, 'node scripts/release-check.mjs')
  const guarantees = run(dir, 'node scripts/check-guarantees.mjs')
  rmSync(dir, { recursive: true, force: true })
  const ok = release.code === 0 && guarantees.code === 0
  console.log(`${ok ? '  ✅' : '  ❌'} release-check exit=${release.code}, guarantee gate exit=${guarantees.code}`)
  if (!ok) {
    failed += 1
    console.log(`     release tail: ${release.output.trim().split('\n').slice(-3).join(' | ')}`)
    console.log(`     guarantees tail: ${guarantees.output.trim().split('\n').slice(-2).join(' | ')}`)
  }
  if (ok) console.log(`     (release-check: ${release.output.trim().split('\n').pop()})`)
}

for (const scenario of scenarios) {
  const dir = freshClone()
  scenario.mutate(dir)
  const result = run(dir, scenario.command)
  rmSync(dir, { recursive: true, force: true })
  const caught = result.code !== 0 && scenario.expect.test(result.output)
  console.log(`${caught ? '✅' : '❌'} ${scenario.name}`)
  if (!caught) {
    failed += 1
    console.log(`     exit=${result.code} expected ${scenario.expect}`)
    console.log(`     output: ${result.output.trim().split('\n').slice(0, 3).join(' | ')}`)
  }
}

if (failed > 0) {
  console.error(`\n❌ ${failed} negative control(s) failed — a gate is not load-bearing as documented`)
  process.exit(1)
}
console.log(`\n✅ all ${scenarios.length} negative controls + the positive control behaved as documented`)
