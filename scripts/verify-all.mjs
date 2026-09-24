#!/usr/bin/env node
/**
 * One command that runs every gate this repo owns and writes a verification
 * report bound to the exact commit it verified.
 *
 * Why: a green claim is only as good as the commit it was measured on. HEAD
 * moves, tags get re-pointed (which this repo does deliberately for unpublished
 * versions), and a conclusion quoted after that is stale — so the report stores
 * the commit, and `--check-fresh` fails when HEAD no longer matches it.
 *
 *   - runs every check (script syntax, the spec suite, the guarantee gate, the
 *     negative controls, the release gate);
 *   - records `{ts, commit, node, steps[{id, command, exit, ok, digest, tail}]}`
 *     in `lib/verify-report.json` (gitignored, so the tree stays clean);
 *   - a failed step is a FAILED verification — there is no "unknown/pass" state;
 *   - the release gate may fail ONLY with its documented post-release item
 *     (already published); anything else fails this script.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const reportPath = join(root, 'lib/verify-report.json')

/** Failure items the release gate may report without failing this script. */
const DOCUMENTED_RELEASE_ITEMS = [/already published/]

const STEPS = [
  { id: 'syntax:release-check', command: 'node --check scripts/release-check.mjs' },
  { id: 'syntax:check-guarantees', command: 'node --check scripts/check-guarantees.mjs' },
  { id: 'syntax:test-negative-controls', command: 'node --check scripts/test-negative-controls.mjs' },
  { id: 'typecheck+unit', command: 'tsc --noEmit && node --test tests/*.test.ts' },
  { id: 'guarantees', command: 'node scripts/check-guarantees.mjs' },
  { id: 'controls', command: 'node scripts/test-negative-controls.mjs' },
  { id: 'release-check', command: 'node scripts/release-check.mjs', documentedFailure: true },
]

function head() {
  return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim()
}

if (process.argv.includes('--check-fresh')) {
  if (!existsSync(reportPath)) {
    console.error(`❌ no verification report at ${reportPath} — run \`npm run verify:all\` before quoting any green state`)
    process.exit(1)
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const current = head()
  if (report.commit !== current) {
    console.error(`❌ the verification report is STALE: it verified ${report.commit.slice(0, 7)} but HEAD is ${current.slice(0, 7)}`)
    console.error('   re-run `npm run verify:all` and quote the new report — do not reuse the old conclusion.')
    process.exit(1)
  }
  console.log(`✅ verification report is fresh for ${current.slice(0, 7)} (${report.ts})`)
  process.exit(0)
}

const steps = []
let failed = 0
for (const step of STEPS) {
  let exit = 0
  let output = ''
  try {
    output = execSync(step.command, { cwd: root, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, DSH_RELEASE_ALLOW_REGISTRY_UNREACHABLE: '1' } })
  } catch (error) {
    exit = error.status ?? 1
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`
  }
  let ok = exit === 0
  if (!ok && step.documentedFailure === true) {
    const items = output.split('\n').filter((line) => /^   - /.test(line))
    const undocumented = items.filter((line) => !DOCUMENTED_RELEASE_ITEMS.some((pattern) => pattern.test(line)))
    ok = items.length > 0 && undocumented.length === 0
    if (!ok) output += `\n(undocumented release-gate failures: ${undocumented.length})`
  }
  const digest = createHash('sha256').update(output).digest('hex')
  steps.push({ id: step.id, command: step.command, exit, ok, digest, tail: output.trim().split('\n').slice(-2).join(' | ').slice(0, 240) })
  console.log(`${ok ? '✔' : '✖'} ${step.id} (exit ${exit}, sha256 ${digest.slice(0, 12)}…)`)
  if (!ok) failed += 1
}

mkdirSync(join(root, 'lib'), { recursive: true })
const report = { ts: new Date().toISOString(), commit: head(), node: process.version, steps }
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(`\nreport: ${reportPath} (commit ${report.commit.slice(0, 7)}, ${report.ts})`)

if (failed > 0) {
  console.error(`\n❌ verify:all failed — ${failed}/${steps.length} step(s) failed. This is a FAILED verification, not an unknown.`)
  process.exit(1)
}
console.log(`\n✅ verify:all passed — ${steps.length}/${steps.length} steps green on ${report.commit.slice(0, 7)}.`)
