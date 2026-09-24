#!/usr/bin/env node
/**
 * Guarantee gate: every negative guarantee documented in `docs/guarantees.md`
 * must be pinned by an test title that actually exists in tests/*.test.ts. A promise without a pinning assertion is not a promise.
 *
 * Why this repo needs it: the routing guard shipped for months matching only
 * the literal `127.0.0.1`, while the README promised "loopback targets are
 * always direct". The assertion that was supposed to catch it passed for the
 * wrong reason (the fixture's `proxiedHosts` did not contain the host it was
 * asserting about, so the function returned "direct" through the unlisted-host
 * branch) — the guard could have been deleted and the suite stayed green.
 *
 * Rules enforced:
 *   1. `docs/guarantees.md` exists and carries rows `| <id> | <guarantee> | <selector> |`;
 *   2. every selector occurs as a test title in `tests/*.test.ts`;
 *   3. the table has at least MIN_ROWS rows (a gutted table fails).
 *
 * A missing guarantee is a hard failure, not a warning.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const MIN_ROWS = 10

let guarantees
try {
  guarantees = readFileSync(join(root, 'docs/guarantees.md'), 'utf8')
} catch {
  console.error('❌ guarantee gate: docs/guarantees.md is missing — every negative guarantee needs a row')
  process.exit(1)
}

const specSources = readdirSync(join(root, 'tests'))
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => readFileSync(join(root, 'tests', name), 'utf8'))
  .join('\n')

const rows = guarantees
  .split('\n')
  .filter((line) => /^\|\s*G\d+\s*\|/.test(line))
  .map((line) => line.split('|').map((cell) => cell.trim()))
  .map((cells) => ({
    id: cells[1],
    guarantee: cells[2],
    selector: (cells[3] ?? '').replace(/^[`"']+|[`"']+$/g, '').trim(),
  }))

const failures = []
if (rows.length < MIN_ROWS) {
  failures.push(`only ${rows.length} guarantee rows (expected at least ${MIN_ROWS}) — do not gut this table`)
}
for (const row of rows) {
  if (!row.selector) {
    failures.push(`${row.id}: no assertion selector`)
    continue
  }
  if (!specSources.includes(row.selector)) {
    failures.push(`${row.id}: no test title matches "${row.selector}" (guarantee: ${row.guarantee})`)
  }
}

if (failures.length > 0) {
  console.error('❌ guarantee gate FAILED — a documented guarantee is not pinned by a test:')
  for (const failure of failures) console.error(`   - ${failure}`)
  console.error('\n   Either add/adjust the test (preferred) or remove the guarantee from the docs.')
  process.exit(1)
}

console.log(`✅ guarantee gate passed: ${rows.length}/${rows.length} negative guarantees pinned by test titles.`)
