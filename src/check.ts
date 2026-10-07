/**
 * Pure check core: `(input, ruleset, options) => Report`.
 *
 * No plugin context, no I/O, no clock and no model access, so the whole rule set
 * is unit-testable without credentials. Every finding carries the verbatim
 * clause that produced it, and every check that could not run is reported in
 * `skipped` so an empty issue list can never be read as "nothing is wrong".
 *
 * The identity checks are driven by a roster the deployment supplies. That is
 * deliberate: "the applicant's name must not appear" is only a checkable
 * statement against a list of names, and the list belongs to the institution
 * running the check, not to a rule pack that ships to everyone.
 */

import { disabledAsSkipped, formatBasis } from './shared/rules.ts'
import { paramNumber, paramStrings, ruleById } from './shared/ruleset.ts'
import { issueId, makeReport } from './shared/report.ts'
import type { Issue, Locator, Report, Skipped } from './shared/report.ts'
import type { Ruleset } from './shared/rules.ts'
import type { ProposalInput } from './model.ts'

/** The institution's own roster of identity terms. */
export interface Roster {
  /** Applicant names. */
  authorNames: string[]
  /** Institution and unit names. */
  institutionNames: string[]
  /** Supervisor or mentor names. */
  advisorNames: string[]
  /** Terms to ignore even when they match, for example a common surname. */
  allowList: string[]
}

/**
 * Merge configured and per-call identity terms.
 * @param base - the roster from configuration.
 * @param extra - terms supplied with a single call.
 * @returns the merged roster, with per-call terms appended.
 */
export function rosterFrom(base: Roster, extra: Partial<Roster> = {}): Roster {
  return {
    authorNames: [...base.authorNames, ...(extra.authorNames ?? [])],
    institutionNames: [...base.institutionNames, ...(extra.institutionNames ?? [])],
    advisorNames: [...base.advisorNames, ...(extra.advisorNames ?? [])],
    allowList: [...base.allowList, ...(extra.allowList ?? [])],
  }
}

/** Options that come from the plugin configuration rather than the rule pack. */
export interface CheckOptions {
  plugin: string
  checkedAt: string
  disabledRules: readonly string[]
  onlyRules: readonly string[]
  skipNotes?: string
  /** Identity terms the deployment knows about. */
  roster: Roster
}

interface RuleContext {
  input: ProposalInput
  ruleset: Ruleset
  roster: Roster
  issues: Issue[]
  skipped: Skipped[]
  fired: Set<string>
  skipReasons: Map<string, string>
  add(ruleId: string, locator: Locator, found: string, expected: string, fix?: string): void
  skip(ruleId: string, reason: string): void
}

function locatorOf(line: number): Locator {
  return { line }
}

function basisOf(ruleset: Ruleset, ruleId: string): string {
  const rule = ruleById(ruleset, ruleId)
  return formatBasis(rule.basis, rule.alsoBasis ?? [])
}

function makeAdd(context: Omit<RuleContext, 'add' | 'skip'>): RuleContext['add'] {
  return (ruleId, locator, found, expected, fix) => {
    const rule = ruleById(context.ruleset, ruleId)
    const issue: Issue = {
      id: issueId(context.ruleset.plugin, ruleId, locator),
      ruleId,
      severity: rule.severity,
      locator,
      found,
      expected,
      basis: formatBasis(rule.basis, rule.alsoBasis ?? []),
    }
    if (fix !== undefined) issue.fix = fix
    context.issues.push(issue)
    context.fired.add(ruleId)
  }
}

/** Escape a term so it can be embedded in a regular expression. */
function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Terms that are actually configured, de-duplicated and longest-first. */
function usableTerms(terms: readonly string[], allowList: readonly string[]): string[] {
  const allowed = new Set(allowList.map((entry) => entry.trim()))
  const unique = new Set<string>()
  for (const term of terms) {
    const trimmed = term.trim()
    if (trimmed.length < 2 || allowed.has(trimmed)) continue
    unique.add(trimmed)
  }
  return [...unique].sort((left, right) => right.length - left.length)
}

/**
 * Scan the body text for identity terms.
 *
 * The terms are described throughout as "identity clues" (身份线索词) and never as
 * a violation: no current national document forbids an applicant's name from
 * appearing in a proposal, so this reports a fact for a human to weigh.
 *
 * @param context - check context.
 * @param ruleId - the rule being evaluated.
 * @param terms - terms to look for.
 * @param label - how the terms are described in the finding.
 * @param scope - restrict the scan to a slice of lines, when the rule has one.
 */
function scanBody(context: RuleContext, ruleId: string, terms: readonly string[], label: string, scope?: { from: number; to: number }): void {
  const usable = usableTerms(terms, context.roster.allowList)
  if (usable.length === 0) {
    context.skip(ruleId, `未配置${label}名单（roster），本条不执行`)
    return
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join('|'))
  const scoped = scope === undefined ? context.input.lines : context.input.lines.filter((entry) => entry.line >= scope.from && entry.line <= scope.to)
  const lines = [...scoped].sort((left, right) => left.line - right.line)
  if (lines.length === 0) {
    context.skip(ruleId, `材料中没有第 ${scope?.from ?? 1} 行至第 ${scope?.to ?? '末尾'} 行的内容，本条不执行`)
    return
  }
  for (const entry of lines) {
    const hit = pattern.exec(entry.text)
    if (hit === null) continue
    context.add(
      ruleId,
      locatorOf(entry.line),
      `第 ${entry.line} 行出现${label}「${hit[0]}」`,
      `该处出现${label}，供人工判断是否构成身份线索`,
      '现行国家文件未禁止正文出现姓名或单位名称，本条为技术性提示；如确认无需处理可加入 allowList',
    )
  }
}

/** NF-001 — the roster must exist before any identity check can mean anything. */
function checkRosterConfigured(context: RuleContext): void {
  const ruleId = 'NF-001'
  const total =
    usableTerms(context.roster.authorNames, context.roster.allowList).length +
    usableTerms(context.roster.institutionNames, context.roster.allowList).length +
    usableTerms(context.roster.advisorNames, context.roster.allowList).length
  if (total > 0) return
  context.add(
    ruleId,
    {},
    '未配置任何可核验的身份词（申请人姓名、依托单位名称、导师姓名均为空）',
    '匿名检查需要名单才能执行；未配置时其余匿名相关检查只能逐条报为未执行',
    '在本机构配置中填入申请人姓名、依托单位名称与导师姓名，或按本机构规则库提供 allowList 例外',
  )
}

/** NF-002 — applicant names must not appear in the body text. */
function checkAuthorNames(context: RuleContext): void {
  scanBody(context, 'NF-002', context.roster.authorNames, '申请人姓名')
}

/** NF-003 — institution and unit names must not appear in the body text. */
function checkInstitutionNames(context: RuleContext): void {
  scanBody(context, 'NF-003', context.roster.institutionNames, '依托单位名称')
}

/** NF-004 — supervisor names must not appear in the body text. */
function checkAdvisorNames(context: RuleContext): void {
  scanBody(context, 'NF-004', context.roster.advisorNames, '导师姓名')
}

/** NF-005 — document title property. */
function checkMetadataTitle(context: RuleContext): void {
  const ruleId = 'NF-005'
  const title = context.input.metadata.title
  if (title === undefined) return
  const usable = usableTerms(
    [...context.roster.authorNames, ...context.roster.institutionNames],
    context.roster.allowList,
  )
  if (usable.length === 0) {
    context.skip(ruleId, '未配置身份词名单，无法判断文档标题是否包含身份信息')
    return
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join('|'))
  const hit = pattern.exec(title)
  if (hit === null) return
  context.add(
    ruleId,
    { column: 'title' },
    `文档标题属性包含身份词「${hit[0]}」：${title}`,
    '电子文档属性中的标题不应包含可识别身份的信息',
    '清除或改写文档属性；该字段在阅读器中不一定可见，但随文件一起流转',
  )
}

/** NF-006 — the author property is the classic anonymity leak. */
function checkMetadataAuthor(context: RuleContext): void {
  const ruleId = 'NF-006'
  const author = context.input.metadata.author
  if (author === undefined) return
  const usable = usableTerms(context.roster.authorNames, context.roster.allowList)
  // Any non-empty author property is reported: a reviewer can see it, whether or
  // not it matches the configured roster.
  if (usable.length === 0) {
    context.add(
      ruleId,
      { column: 'author' },
      `文档属性中的作者字段为「${author}」`,
      '电子文档属性中的作者字段应清空或改为不含个人身份的内容',
      '清除文档属性后重新生成文件；未配置名单时本条仍会报出非空作者字段',
    )
    return
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join('|'))
  const hit = pattern.exec(author)
  context.add(
    ruleId,
    { column: 'author' },
    hit === null ? `文档属性中的作者字段非空：「${author}」` : `文档属性中的作者字段包含申请人姓名「${hit[0]}」：${author}`,
    '电子文档属性中的作者字段应清空或改为不含个人身份的内容',
    '清除文档属性后重新生成文件',
  )
}

/** NF-007 — company property. */
function checkMetadataCompany(context: RuleContext): void {
  const ruleId = 'NF-007'
  const company = context.input.metadata.company
  if (company === undefined) return
  const usable = usableTerms(context.roster.institutionNames, context.roster.allowList)
  const pattern = usable.length === 0 ? undefined : new RegExp(usable.map(escapeRegExp).join('|'))
  const hit = pattern?.exec(company) ?? null
  if (usable.length > 0 && hit === null) return
  context.add(
    ruleId,
    { column: 'company' },
    usable.length === 0 ? `文档属性中的单位字段非空：「${company}」` : `文档属性中的单位字段包含依托单位名称「${hit?.[0] ?? ''}」：${company}`,
    '电子文档属性中的单位字段不应包含依托单位名称',
    '清除文档属性后重新生成文件',
  )
}

/** NF-008 — last-modified-by property. */
function checkMetadataLastModifiedBy(context: RuleContext): void {
  const ruleId = 'NF-008'
  const value = context.input.metadata.lastModifiedBy
  if (value === undefined) return
  const usable = usableTerms(context.roster.authorNames, context.roster.allowList)
  if (usable.length === 0) {
    context.skip(ruleId, '未配置申请人姓名名单，无法判断「最后修改者」字段是否含姓名')
    return
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join('|'))
  const hit = pattern.exec(value)
  if (hit === null) return
  context.add(
    ruleId,
    { column: 'lastModifiedBy' },
    `文档属性中的「最后修改者」包含申请人姓名「${hit[0]}」：${value}`,
    '电子文档属性中的「最后修改者」不应包含申请人姓名',
    '清除文档属性后重新生成文件',
  )
}

/** NF-009 — the cover page is allowed to name the applicant; other parts are not. */
function checkCoverPageScope(context: RuleContext): void {
  const ruleId = 'NF-009'
  const rule = ruleById(context.ruleset, ruleId)
  const coverLines = paramNumber(rule, 'coverLines', 0)
  if (coverLines <= 0) {
    context.skip(ruleId, '规则库未配置 coverLines，无法区分「封面可署名」与「正文需匿名」的范围')
    return
  }
  const outside = context.input.lines.filter((entry) => entry.line > coverLines)
  if (outside.length === 0) {
    context.skip(ruleId, `材料只有 ${context.input.lines.length} 行，未超过配置的封面行数 ${coverLines}`)
    return
  }
  const terms = [...context.roster.authorNames, ...context.roster.institutionNames, ...context.roster.advisorNames]
  const usable = usableTerms(terms, context.roster.allowList)
  if (usable.length === 0) {
    context.skip(ruleId, '未配置身份词名单，无法区分封面与正文中的身份词出现位置')
    return
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join('|'))
  const coverHits = context.input.lines.filter((entry) => entry.line <= coverLines && pattern.test(entry.text)).length
  const bodyHits = outside.filter((entry) => pattern.test(entry.text)).length
  if (bodyHits === 0) return
  if (coverHits === 0) {
    context.add(
      ruleId,
      { line: coverLines + 1 },
      `配置的封面范围为前 ${coverLines} 行，但封面内未出现任何身份词，正文中出现 ${bodyHits} 处`,
      '封面通常需要署名，正文需要匿名；范围配置与实际材料不符时应先核对材料结构',
      '核对 coverLines 是否与本机构的申请书模板一致',
    )
    return
  }
  context.add(
    ruleId,
    { line: coverLines + 1 },
    `封面（前 ${coverLines} 行）出现 ${coverHits} 处身份词，正文（第 ${coverLines + 1} 行起）出现 ${bodyHits} 处`,
    '封面可署名，需要匿名送审的正文部分不应出现身份词',
    '逐处核对正文中的身份词；本条只按配置的行范围划分，行范围须与本机构模板一致',
  )
}

/** NF-010 — page and word limits are yearly policy, so they ship unconfigured. */
function checkLengthLimits(context: RuleContext): void {
  const ruleId = 'NF-010'
  const rule = ruleById(context.ruleset, ruleId)
  const maxLines = paramNumber(rule, 'maxLines', 0)
  const maxChars = paramNumber(rule, 'maxChars', 0)
  if (maxLines <= 0 && maxChars <= 0) {
    context.skip(
      ruleId,
      '规则库未配置 maxLines / maxChars：页数与字数限额逐年变化且按项目类型不同，本条不执行；如需启用请按当年指南填写',
    )
    return
  }
  const totalChars = context.input.lines.reduce((sum, entry) => sum + entry.text.length, 0)
  if (maxLines > 0 && context.input.lines.length > maxLines) {
    context.add(
      ruleId,
      { line: maxLines + 1 },
      `材料共 ${context.input.lines.length} 行，超过配置的 ${maxLines} 行`,
      `按本机构配置，材料行数不应超过 ${maxLines} 行`,
      '核对当年指南的页数或字数限额；行数只是段落数的近似，不等同于页数',
    )
  }
  if (maxChars > 0 && totalChars > maxChars) {
    context.add(
      ruleId,
      {},
      `材料正文共 ${totalChars} 字，超过配置的 ${maxChars} 字`,
      `按本机构配置，正文字数不应超过 ${maxChars} 字`,
      '核对当年指南的字数限额',
    )
  }
}

/**
 * NF-011 — the institution's own form-review item list.
 *
 * The items are entirely deployment-specific, so the rule ships with an empty
 * list and reports itself as skipped until one is configured. The `match` form is
 * deliberately literal: this check confirms a phrase is present, it does not
 * interpret it.
 */
function checkFormReviewItems(context: RuleContext): void {
  const ruleId = 'NF-011'
  const rule = ruleById(context.ruleset, ruleId)
  const specs = Array.isArray(rule.params.require) ? rule.params.require : []
  if (specs.length === 0) {
    context.skip(
      ruleId,
      '规则库未配置 require：形式审查项清单由本机构或当年指南确定，本条不执行；配置形如 require: [{ label: 申请人签字, match: 申请人签字 }]',
    )
    return
  }
  const text = context.input.lines.map((entry) => entry.text).join('\n')
  for (const spec of specs) {
    if (typeof spec !== 'object' || spec === null) continue
    const record = spec as Record<string, unknown>
    const label = typeof record.label === 'string' ? record.label : undefined
    const match = typeof record.match === 'string' ? record.match : undefined
    if (label === undefined || match === undefined) continue
    if (text.includes(match)) continue
    context.add(
      ruleId,
      {},
      `材料中未找到「${match}」`,
      `按本机构配置的形式审查清单，应包含「${label}」`,
      '核对材料是否齐全；本条只做字面存在性检查，不判断栏目填写是否正确',
    )
  }
}

/**
 * NF-012 — a repeat proposal must disclose what it continues from.
 *
 * Whether a proposal IS a repeat cannot be derived from its text, so the caller
 * states it, and the rule checks the disclosure the deployment requires.
 */
function checkRepeatDisclosure(context: RuleContext): void {
  const ruleId = 'NF-012'
  const rule = ruleById(context.ruleset, ruleId)
  const markers = paramStrings(rule, 'markerPatterns', [])
  if (markers.length === 0) {
    context.skip(ruleId, '规则库未配置 markerPatterns，无法识别材料是否声明为重复申请或延续申请')
    return
  }
  const text = context.input.lines.map((entry) => entry.text).join('\n')
  const isRepeat = markers.some((marker) => text.includes(marker))
  if (!isRepeat) {
    context.skip(ruleId, '材料中未出现重复申请或延续申请的声明标记，本条不适用')
    return
  }
  const disclosure = paramStrings(rule, 'requiredDisclosure', [])
  if (disclosure.length === 0) {
    context.skip(ruleId, '规则库未配置 requiredDisclosure：未找到国家层面对该声明内容的明文要求')
    return
  }
  const missing = disclosure.filter((phrase) => !text.includes(phrase))
  if (missing.length === 0) return
  context.add(
    ruleId,
    {},
    `材料声明为重复或延续申请，但未找到：${missing.join('、')}`,
    '重复或延续申请应按本机构配置披露说明',
    '补齐说明；披露内容的要求由本机构或当年指南确定，本条只核对其是否出现',
  )
}

/**
 * NF-013 — other sections are only complaint-checked when their content is
 * actually part of the anonymity scope, which is a deployment decision.
 */
function checkOutOfScopeSections(context: RuleContext): void {
  const ruleId = 'NF-013'
  const rule = ruleById(context.ruleset, ruleId)
  const patched = paramStrings(rule, 'patchedSections', [])
  const scopeFrom = paramNumber(rule, 'scopeFromLine', 0)
  const scopeTo = paramNumber(rule, 'scopeToLine', 0)
  if (patched.length === 0 || scopeFrom <= 0 || scopeTo < scopeFrom) {
    context.skip(
      ruleId,
      '规则库未同时配置 patchedSections 与 scopeFromLine / scopeToLine，无法界定需匿名章节的行范围，本条不执行',
    )
    return
  }
  scanBody(context, ruleId, patched, '限定范围内不应出现的身份词', { from: scopeFrom, to: scopeTo })
}

/**
 * NF-014 — the yearly guidelines *require* the advisor's name to be filled in.
 *
 * This is the inverse of NF-004 and the two are not in conflict: NF-004 flags a
 * name as a possible identity clue (a technical suggestion with no legal basis),
 * while this rule checks a disclosure the guidelines do require. Both are off by
 * default, because the guideline wording changes every year and the form layout
 * differs per institution.
 */
function checkAdvisorDisclosure(context: RuleContext): void {
  const ruleId = 'NF-014'
  const rule = ruleById(context.ruleset, ruleId)
  if (rule.params.requireMention !== true) {
    context.skip(
      ruleId,
      '规则库未启用 requireMention：导师姓名的填写形式因模板而异，且该要求出自年度指南，需按当年指南复核后再开启',
    )
    return
  }
  const terms = usableTerms(context.roster.advisorNames, context.roster.allowList)
  if (terms.length === 0) {
    context.skip(ruleId, '未配置 advisorNames，无法核对导师姓名是否已如实填写')
    return
  }
  const text = context.input.lines.map((entry) => entry.text).join('\n')
  const missing = terms.filter((term) => !text.includes(term))
  if (missing.length === 0) return
  context.add(
    ruleId,
    {},
    `材料中未找到配置的导师姓名：${missing.join('、')}`,
    '申请人应当如实填写研究生导师和博士后合作导师姓名，不得错填漏填',
    '核对是否漏填；本条依据为年度指南，须按当年指南复核措辞与适用范围',
  )
}

/**
 * NF-015 — the one "must not appear" clause that really exists.
 *
 * It governs classified and sensitive information, not identity, and the two are
 * easy to confuse. The term list ships empty because what counts as classified
 * is defined by the state secrecy rules, not by this plugin.
 */
function checkClassifiedTerms(context: RuleContext): void {
  const ruleId = 'NF-015'
  const rule = ruleById(context.ruleset, ruleId)
  const terms = paramStrings(rule, 'secretTerms', [])
  const usable = usableTerms(terms, context.roster.allowList)
  if (usable.length === 0) {
    context.skip(
      ruleId,
      '规则库未配置 secretTerms：涉密范围由国家保密规定界定，本插件不硬编码涉密词表；如需启用请由本机构保密管理要求填写',
    )
    return
  }
  const pattern = new RegExp(usable.map(escapeRegExp).join('|'))
  for (const entry of context.input.lines) {
    const hit = pattern.exec(entry.text)
    if (hit === null) continue
    context.add(
      ruleId,
      locatorOf(entry.line),
      `第 ${entry.line} 行命中配置的涉密或敏感词「${hit[0]}」`,
      '申请书中不得含有涉密信息或敏感信息',
      '按本机构保密管理要求核实；本条只做字面匹配，是否属于涉密须由保密审查确认',
    )
  }
}

const CHECKERS: readonly ((context: RuleContext) => void)[] = [
  checkRosterConfigured,
  checkAuthorNames,
  checkInstitutionNames,
  checkAdvisorNames,
  checkMetadataTitle,
  checkMetadataAuthor,
  checkMetadataCompany,
  checkMetadataLastModifiedBy,
  checkCoverPageScope,
  checkLengthLimits,
  checkFormReviewItems,
  checkRepeatDisclosure,
  checkOutOfScopeSections,
  checkAdvisorDisclosure,
  checkClassifiedTerms,
]

/**
 * Run the whole rule pack against one proposal.
 * @param input - normalized material.
 * @param ruleset - validated rule pack.
 * @param options - plugin identity, clock value, rule selection and roster.
 * @returns the report, with `skipped` listing every check that did not run.
 */
export function runCheck(input: ProposalInput, ruleset: Ruleset, options: CheckOptions): Report {
  const disabled = new Set([...ruleset.disabled, ...options.disabledRules])
  const only = new Set(options.onlyRules)
  const base = {
    input,
    ruleset,
    roster: options.roster,
    issues: [] as Issue[],
    skipped: [] as Skipped[],
    fired: new Set<string>(),
    skipReasons: new Map<string, string>(),
  }
  const context: RuleContext = {
    ...base,
    add: makeAdd(base),
    skip: (ruleId, reason) => {
      const existing = base.skipReasons.get(ruleId)
      base.skipReasons.set(ruleId, existing === undefined ? reason : `${existing}；${reason}`)
    },
  }

  for (const checker of CHECKERS) checker(context)

  const withNote = (reason: string): string => (options.skipNotes === undefined ? reason : `${reason}；${options.skipNotes}`)
  const skipped: Skipped[] = disabledAsSkipped(ruleset, [...disabled], withNote('该规则在当前配置中被禁用'))
  const already = new Set(skipped.map((entry) => entry.rule))
  for (const [ruleId, reason] of base.skipReasons) {
    if (already.has(ruleId)) continue
    if (disabled.has(ruleId) || (options.onlyRules.length > 0 && !only.has(ruleId))) continue
    skipped.push({ rule: ruleId, reason: withNote(reason) })
    already.add(ruleId)
  }
  for (const rule of ruleset.rules) {
    if (disabled.has(rule.id) || base.fired.has(rule.id) || already.has(rule.id)) continue
    if (options.onlyRules.length > 0 && !only.has(rule.id)) continue
    skipped.push({ rule: rule.id, reason: withNote('材料满足该检查的前置条件且未发现差异条目') })
  }
  if (options.onlyRules.length > 0) {
    const notSelected = ruleset.rules.filter((rule) => !only.has(rule.id) && !disabled.has(rule.id))
    if (notSelected.length > 0) {
      skipped.push({
        rule: notSelected.map((rule) => rule.id).join(','),
        reason: withNote(`本次调用通过 only 参数把执行范围限制为 ${[...only].join(', ')}，上列规则未执行`),
      })
    }
  }

  return makeReport({
    plugin: options.plugin,
    target: input.target,
    rulesetVersion: ruleset.version,
    checkedAt: options.checkedAt,
    issues: context.issues,
    skipped,
  })
}
