/**
 * Minimal first run for dsh-nsfc-form-check.
 *
 * Input: `input/NF-002-unsafe.json` is the package's own synthetic fixture for
 * rule NF-002 (an applicant name appears in the body text). The fixture also
 * carries the roster it was written against; the tool does not read a roster out
 * of the material, so the same three lists are passed as tool arguments here.
 *
 *   node samples/quickstart/run.mjs           human-readable summary
 *   node samples/quickstart/run.mjs --json    the same summary as JSON
 *   node samples/quickstart/run.mjs --check   compare against expected/result.json
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as plugin from '../../lib/index.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const registered = []
const ctx = { tools: { register: (tool) => { registered.push(tool); return () => {} } } }
plugin.apply(ctx, plugin.Config({}))
const tool = registered.find((t) => t.name === plugin.TOOL_NAME)
if (!tool) throw new Error('tool not registered: ' + plugin.TOOL_NAME)

const result = await tool.execute(
  {
    file: join(here, 'input', 'NF-002-unsafe.json'),
    authorNames: ['张伟'],
    institutionNames: ['示例大学', '示例大学附属第一医院'],
    advisorNames: ['李建国'],
  },
  { signal: new AbortController().signal },
)

const summary = {
  tool: tool.name,
  issueCount: result.issueCount,
  summary: result.summary,
  skippedCount: result.skippedCount,
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2))
} else if (process.argv.includes('--check')) {
  const expected = JSON.parse(await readFile(join(here, 'expected', 'result.json'), 'utf8'))
  if (JSON.stringify(summary, null, 2) !== JSON.stringify(expected, null, 2)) {
    console.error('quickstart: output differs from expected/result.json')
    console.error('--- expected\n' + JSON.stringify(expected, null, 2))
    console.error('--- actual\n' + JSON.stringify(summary, null, 2))
    process.exit(1)
  }
  console.log(`${tool.name}: quickstart OK — output matches expected/result.json`)
} else {
  console.log('$ node samples/quickstart/run.mjs')
  console.log(
    `${tool.name}: ${summary.issueCount} issue(s) — error ${summary.summary.error}, ` +
      `warn ${summary.summary.warn}, info ${summary.summary.info}`,
  )
  console.log('skipped: ' + summary.skippedCount)
}
