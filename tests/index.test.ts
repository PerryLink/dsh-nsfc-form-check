import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadRuleset } from '../src/shared/ruleset.ts'
import { MaterialError, parseMaterial, textFromDocumentXml } from '../src/parse.ts'
import { runCheck, type Roster } from '../src/check.ts'
import { rosterFrom } from '../src/index.ts'
import { buildView } from '../src/view.ts'
import { findForbiddenWording } from '../src/shared/wording.ts'
import { addDays, diffDays, parseWallClock } from '../src/shared/datetime.ts'
import { parseYaml } from '../src/shared/yaml.ts'
import { Config as ConfigSchema } from '../src/config.ts'
import { inject, name as pluginName, resolvePackageFile, TOOL_NAME } from '../src/index.ts'
import { buildDocx, coreXml } from './docx-fixture.ts'
import type { Report } from '../src/shared/report.ts'
import type { CheckOptions } from '../src/check.ts'
import type { DocumentMetadata } from '../src/model.ts'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const rulesPath = join(packageRoot, 'rules', 'nsfc-form-check.yaml')
const fixturesRoot = join(here, 'fixtures')
const CHECKED_AT = '2026-10-06T00:00:00.000Z'

/** The fixture material shape: text, metadata, roster, and any rule configuration. */
interface FixtureMaterial {
  text: string
  metadata: DocumentMetadata
  roster: Roster
  configure?: Record<string, Record<string, unknown>>
}

interface CaseFile {
  ruleId: string
  pairs: { name: string; material: string; expect: { ruleId: string; count: number } }[]
}

async function loadPack() {
  return loadRuleset(await readFile(rulesPath, 'utf8'))
}

function runOptions(overrides: Partial<CheckOptions> = {}): CheckOptions {
  return {
    plugin: pluginName,
    checkedAt: CHECKED_AT,
    disabledRules: [],
    onlyRules: [],
    roster: { authorNames: [], institutionNames: [], advisorNames: [], allowList: [] },
    ...overrides,
  }
}

function withConfiguration(ruleset: Awaited<ReturnType<typeof loadPack>>, configure: FixtureMaterial['configure']) {
  if (configure === undefined) return ruleset
  return {
    ...ruleset,
    rules: ruleset.rules.map((rule) =>
      configure[rule.id] === undefined ? rule : { ...rule, params: { ...rule.params, ...configure[rule.id] } },
    ),
  }
}

async function runFixture(fixture: FixtureMaterial): Promise<Report> {
  const ruleset = withConfiguration(await loadPack(), fixture.configure)
  const input = parseMaterial({ target: 'inline', text: fixture.text, metadata: fixture.metadata })
  return runCheck(input, ruleset, runOptions({ roster: fixture.roster }))
}

function issuesOf(report: Report, ruleId: string) {
  return report.issues.filter((issue) => issue.ruleId === ruleId)
}

async function ruleDirectories(): Promise<string[]> {
  const entries = await readdir(fixturesRoot, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

async function readCases(directory: string): Promise<CaseFile> {
  return JSON.parse(await readFile(join(fixturesRoot, directory, 'cases.json'), 'utf8')) as CaseFile
}

async function readFixture(directory: string, file: string): Promise<FixtureMaterial> {
  return JSON.parse(await readFile(join(fixturesRoot, directory, file), 'utf8')) as FixtureMaterial
}

const ROSTER: Roster = {
  authorNames: ['张伟'],
  institutionNames: ['示例大学'],
  advisorNames: ['李建国'],
  allowList: [],
}

describe('rule pack', () => {
  it('declares a citable basis for every rule', async () => {
    const ruleset = await loadPack()
    expect(ruleset.plugin).toBe(pluginName)
    expect(ruleset.rules.length).toBeGreaterThanOrEqual(13)
    for (const rule of ruleset.rules) {
      expect(rule.basis.document, `${rule.id} document`).not.toBe('')
      expect(rule.basis.clause, `${rule.id} clause`).not.toBe('')
      expect(rule.basis.excerpt.length, `${rule.id} excerpt`).toBeGreaterThanOrEqual(8)
      expect(rule.basis.source, `${rule.id} source`).toMatch(/^https?:\/\//)
      expect(['direct', 'derived-from-principle', 'institutional-configuration']).toContain(rule.basis.kind)
    }
  })

  it('never lets a principle-derived or locally configured check be an error', async () => {
    const ruleset = await loadPack()
    for (const rule of ruleset.rules) {
      if (rule.basis.kind === 'derived-from-principle') expect(rule.severity, rule.id).not.toBe('error')
      if (rule.basis.kind === 'institutional-configuration') expect(rule.severity, rule.id).toBe('info')
    }
  })

  it('ships every yearly policy knob unconfigured rather than freezing a year-specific number', async () => {
    const ruleset = await loadPack()
    const length = ruleset.rules.find((rule) => rule.id === 'NF-010')
    expect(length?.params.maxLines).toBe(0)
    expect(length?.params.maxChars).toBe(0)
    expect(length?.basis.kind).toBe('institutional-configuration')
    const items = ruleset.rules.find((rule) => rule.id === 'NF-011')
    expect(items?.params.require).toEqual([])
    const repeat = ruleset.rules.find((rule) => rule.id === 'NF-012')
    expect(repeat?.params.markerPatterns).toEqual([])
    expect(repeat?.params.requiredDisclosure).toEqual([])
    const scope = ruleset.rules.find((rule) => rule.id === 'NF-013')
    expect(scope?.params.scopeFromLine).toBe(0)
  })

  it('attributes the anonymity requirement to the current revision of the regulation', async () => {
    const ruleset = await loadPack()
    const names = ruleset.rules.find((rule) => rule.id === 'NF-002')
    expect(names?.basis.clause).toBe('第二十一条')
    expect(names?.basis.number).toBe('国务院令第796号')
    expect(names?.basis.kind).toBe('derived-from-principle')
    expect(names?.note).toContain('未找到任何现行明文')
    expect(names?.note).toContain('都可能命中')
  })

  it('never cites the superseded 2007 order number', async () => {
    const ruleset = await loadPack()
    for (const rule of ruleset.rules) {
      expect(rule.basis.number, rule.id).not.toContain('487')
      for (const extra of rule.alsoBasis ?? []) expect(extra.number, rule.id).not.toContain('487')
    }
  })

  it('cites the review-confidentiality clause verbatim in the rules that rest on it', async () => {
    const ruleset = await loadPack()
    const rules = ruleset.rules.filter((rule) => rule.id.startsWith('NF-0'))
    const derived = rules.filter((rule) => rule.basis.kind === 'derived-from-principle')
    expect(derived.length).toBeGreaterThanOrEqual(9)
    expect(rules.some((rule) => rule.basis.excerpt.includes('不得以任何方式披露未公开的评审专家'))).toBe(true)
  })

  it('cites the four statutory grounds for non-acceptance where the form review rests on them', async () => {
    const ruleset = await loadPack()
    const length = ruleset.rules.find((rule) => rule.id === 'NF-010')
    expect(length?.alsoBasis?.[0]?.clause).toBe('第十三条（二）')
    expect(length?.alsoBasis?.[0]?.excerpt).toContain('申请材料不符合年度基金项目指南要求的')
    const items = ruleset.rules.find((rule) => rule.id === 'NF-011')
    expect(items?.basis.clause).toBe('第十条（二）')
    expect(items?.basis.excerpt).toContain('真实性、完整性和合法性')
  })

  it('refuses a rule pack that overstates a principle-derived check', () => {
    const overstated = [
      'plugin: probe',
      'version: "0"',
      'rules:',
      '  - id: X-001',
      '    title: probe',
      '    severity: error',
      '    basis:',
      '      document: 《X》',
      '      number: X〔2020〕1号',
      '      clause: 第一条',
      '      excerpt: 这是一个足够长的逐字摘录示例。',
      '      kind: derived-from-principle',
      '      source: https://example.invalid/x',
    ].join('\n')
    expect(() => loadRuleset(overstated)).toThrow(/strongest permitted severity/)
  })
})

describe('paired fixtures', () => {
  it('has both a compliant and a violating sample for every rule', async () => {
    const ruleset = await loadPack()
    const covered = new Set<string>()
    for (const directory of await ruleDirectories()) {
      const cases = await readCases(directory)
      expect(cases.pairs.filter((pair) => pair.expect.count === 0).length, `${directory} compliant sample`).toBeGreaterThanOrEqual(1)
      expect(cases.pairs.filter((pair) => pair.expect.count > 0).length, `${directory} violating sample`).toBeGreaterThanOrEqual(1)
      for (const pair of cases.pairs) {
        const fixture = await readFixture(directory, pair.material)
        const report = await runFixture(fixture)
        const matched = issuesOf(report, cases.ruleId)
        expect(
          matched.length,
          `${directory}/${pair.name} expected ${pair.expect.count} × ${cases.ruleId}, got ${matched.map((issue) => issue.found).join(' | ')}`,
        ).toBe(pair.expect.count)
        covered.add(cases.ruleId)
      }
    }
    for (const rule of ruleset.rules) expect(covered.has(rule.id), `covered ${rule.id}`).toBe(true)
  })

  it('gives every issue a citable basis and a stable id', async () => {
    for (const directory of await ruleDirectories()) {
      const cases = await readCases(directory)
      for (const pair of cases.pairs) {
        const fixture = await readFixture(directory, pair.material)
        const report = await runFixture(fixture)
        for (const issue of report.issues) {
          expect(issue.basis).toContain('「')
          expect(issue.id).toMatch(/^dsh-nsfc-form-check\.NF-\d{3}\.[0-9a-f]{8}$/)
          expect(issue.found).not.toBe('')
          expect(issue.expected).not.toBe('')
        }
      }
    }
  })
})

describe('anonymity scope', () => {
  it('reports every matching line, with its line number', async () => {
    const ruleset = await loadPack()
    const input = parseMaterial({
      target: 'inline',
      text: ['第一行', '由张伟负责', '第三行', '张伟与李建国共同完成'].join('\n'),
    })
    const report = runCheck(input, ruleset, runOptions({ roster: ROSTER }))
    // Report order is severity, then rule, then a stable locator hash — not line
    // order — so the assertion is on the set of located lines, and separately on
    // the fact that each finding carries a line number a reviewer can jump to.
    const lines = issuesOf(report, 'NF-002')
      .map((issue) => issue.locator.line)
      .sort((left, right) => (left ?? 0) - (right ?? 0))
    expect(lines).toEqual([2, 4])
    for (const issue of issuesOf(report, 'NF-003')) expect(issue.locator.line).toBeUndefined()
  })

  it('honours the allow list so a common surname does not flood the report', async () => {
    const ruleset = await loadPack()
    const input = parseMaterial({ target: 'inline', text: '张伟与另一名作者' })
    const report = runCheck(input, ruleset, runOptions({ roster: { ...ROSTER, allowList: ['张伟'] } }))
    expect(issuesOf(report, 'NF-002').length).toBe(0)
    expect(report.skipped.find((entry) => entry.rule === 'NF-002')?.reason).toContain('未配置')
  })

  it('skips every identity check, by name, when no roster is configured', async () => {
    const ruleset = await loadPack()
    const input = parseMaterial({ target: 'inline', text: '正文内容' })
    const report = runCheck(input, ruleset, runOptions())
    for (const ruleId of ['NF-002', 'NF-003', 'NF-004']) {
      expect(issuesOf(report, ruleId).length, `${ruleId} must not fire without a roster`).toBe(0)
      expect(report.skipped.find((entry) => entry.rule === ruleId)?.reason).toContain('未配置')
    }
    expect(issuesOf(report, 'NF-001')).toHaveLength(1)
  })

  it('merges configuration and per-call roster terms', () => {
    const config = {
      rulesFile: 'rules/nsfc-form-check.yaml',
      disabledRules: [],
      onlyRules: [],
      skipNotes: '',
      authorNames: ['甲'],
      institutionNames: ['乙大学'],
      advisorNames: [],
      allowList: ['例外'],
      timeoutMs: 1000,
    }
    const merged = rosterFrom(config, { authorNames: ['丙'], allowList: ['另一个例外'] })
    expect(merged.authorNames).toEqual(['甲', '丙'])
    expect(merged.institutionNames).toEqual(['乙大学'])
    expect(merged.allowList).toEqual(['例外', '另一个例外'])
  })
})

describe('docx and metadata handling', () => {
  it('extracts paragraph text from a real docx package', () => {
    const buffer = buildDocx(['第一段', '第二段', '第三段'], { creator: '张伟' })
    const input = parseMaterial({ target: 'proposal.docx', bytes: buffer })
    expect(input.lines.map((entry) => entry.text)).toEqual(['第一段', '第二段', '第三段'])
    expect(input.metadata.author).toBe('张伟')
    expect(input.sourceFormat).toBe('docx')
  })

  it('flags the author, company and last-modified-by properties of a real docx package', async () => {
    const buffer = buildDocx(['正文'], { creator: '张伟', company: '示例大学', lastModifiedBy: '张伟' })
    const input = parseMaterial({ target: 'proposal.docx', bytes: buffer })
    const ruleset = await loadPack()
    const result = runCheck(input, ruleset, runOptions({ roster: ROSTER }))
    expect(issuesOf(result, 'NF-006').length).toBe(1)
    expect(issuesOf(result, 'NF-007').length).toBe(1)
    expect(issuesOf(result, 'NF-008').length).toBe(1)
  })

  it('leaves metadata undefined when the package carries no core properties', () => {
    const buffer = buildDocx(['正文'], {})
    const input = parseMaterial({ target: 'proposal.docx', bytes: buffer })
    expect(input.metadata.author).toBeUndefined()
  })

  it('refuses to invent page numbers for a PDF', () => {
    expect(() => parseMaterial({ target: 'proposal.pdf', bytes: Buffer.from('%PDF-1.7') })).toThrow(/不解析 PDF/)
  })

  it('accepts caller-extracted PDF text and records that the extraction was external', () => {
    const input = parseMaterial({ target: 'proposal.pdf', bytes: Buffer.from('%PDF-1.7'), text: '正文' })
    expect(input.warnings.join(' ')).toContain('调用方抽取')
  })

  it('rejects a non-ZIP file passed as docx', () => {
    expect(() => parseMaterial({ target: 'proposal.docx', bytes: Buffer.from('not a zip at all') })).toThrow(MaterialError)
  })

  it('decodes XML entities in document text', () => {
    expect(textFromDocumentXml('<w:body><w:p><w:r><w:t>a &amp; b</w:t></w:r></w:p></w:body>')).toEqual(['a & b'])
  })

  it('writes core properties including the company field', () => {
    const xml = coreXml({ title: '标题', creator: '张伟', lastModifiedBy: '李四' })
    expect(xml).toContain('<dc:title>标题</dc:title>')
    expect(xml).toContain('<dc:creator>张伟</dc:creator>')
    expect(xml).toContain('<cp:lastModifiedBy>李四</cp:lastModifiedBy>')
  })
})

describe('material reader', () => {
  it('rejects empty material instead of reporting an empty result', () => {
    expect(() => parseMaterial({ target: 'inline', text: '   ' })).toThrow(/未能从材料中读取到任何正文行/)
  })

  it('accepts a JSON payload with explicit lines and metadata', () => {
    const input = parseMaterial({
      target: 'inline',
      text: JSON.stringify({ lines: ['甲', '乙'], metadata: { author: '张伟' } }),
    })
    expect(input.lines.map((entry) => entry.text)).toEqual(['甲', '乙'])
    expect(input.metadata.author).toBe('张伟')
  })

  it('rejects malformed JSON material', () => {
    expect(() => parseMaterial({ target: 'inline', text: '{ not json' })).toThrow(/JSON 无法解析/)
  })
})

describe('report rendering', () => {
  it('never uses adjudicating wording and always carries the disclaimer', async () => {
    const fixture = await readFixture('NF-002', 'NF-002-unsafe.json')
    const report = await runFixture(fixture)
    const view = buildView(report)
    expect(findForbiddenWording(view.markdown)).toEqual([])
    expect(view.markdown).toContain('免责声明')
    expect(view.markdown).toContain('未执行的检查')
    expect(JSON.parse(view.reportJson)).toMatchObject({ plugin: pluginName, summary: report.summary })
  })
})

describe('plugin contract', () => {
  it('declares a static inject array covering every service apply touches', () => {
    expect(Array.isArray(inject)).toBe(true)
    expect(inject).toContain('tools')
  })

  it('exposes a Schemastery Config with an empty default roster', () => {
    const resolved = ConfigSchema(null)
    expect(resolved.rulesFile).toBe('rules/nsfc-form-check.yaml')
    expect(resolved.authorNames).toEqual([])
    expect(resolved.institutionNames).toEqual([])
    expect(resolved.advisorNames).toEqual([])
    expect(resolved.allowList).toEqual([])
    expect(resolved.timeoutMs).toBeGreaterThan(0)
  })

  it('resolves the packaged rule pack and rejects a missing one', () => {
    expect(resolvePackageFile('rules/nsfc-form-check.yaml')).toBe(rulesPath)
    expect(() => resolvePackageFile('rules/does-not-exist.yaml')).toThrow(/未找到/)
  })

  it('names the tool after the package family convention', () => {
    expect(TOOL_NAME).toBe('nsfc_form_check')
  })
})

describe('shared kit', () => {
  it('parses wall-clock timestamps and rejects impossible dates', () => {
    expect(parseWallClock('2026-03-15 08:30')).toEqual({ date: '2026-03-15', time: '08:30', hasTime: true, minutes: 510 })
    expect(parseWallClock('2026-02-30')).toBeUndefined()
  })

  it('does calendar arithmetic', () => {
    expect(addDays('2026-03-31', 1)).toBe('2026-04-01')
    expect(diffDays('2026-03-01', '2026-03-06')).toBe(5)
  })

  it('reads the supported YAML subset and rejects the rest', () => {
    expect(parseYaml('a: 1\nb:\n  - x\n')).toEqual({ a: 1, b: ['x'] })
    expect(() => parseYaml('a: 1\na: 2\n')).toThrow(/duplicate/)
  })
})
