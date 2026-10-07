import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Config } from './config.ts'
import type { Config as ConfigShape } from './config.ts'
import { runCheck, type Roster } from './check.ts'
import { MaterialError, parseMaterial, type MaterialSource } from './parse.ts'
import { buildView } from './view.ts'
import { loadRulesetFile } from './shared/memo.ts'

export const name = 'dsh-nsfc-form-check'
export const inject = ['tools']
export { Config }

/** Tool id exposed to the model, and the row id in `cordis.patch.yml`. */
export const TOOL_NAME = 'nsfc_form_check'

/**
 * Locate a package-owned file such as the rule pack.
 *
 * Resolution order: absolute path, then every ancestor of the module directory,
 * then the process working directory. A wrong silent fallback would build a
 * report from the wrong rule pack, so a miss throws with the paths tried.
 *
 * @param relative - configured path, relative to the plugin package root.
 * @returns the resolved absolute path.
 * @throws Error naming every location tried, when the file is absent.
 */
export function resolvePackageFile(relative: string): string {
  if (isAbsolute(relative)) {
    if (existsSync(relative)) return relative
    throw new Error(`规则库文件不存在：${relative}`)
  }
  const tried: string[] = []
  let current = import.meta.dirname ?? process.cwd()
  for (;;) {
    const candidate = resolve(current, relative)
    tried.push(candidate)
    if (existsSync(candidate)) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const fromCwd = resolve(process.cwd(), relative)
  if (!tried.includes(fromCwd)) {
    tried.push(fromCwd)
    if (existsSync(fromCwd)) return fromCwd
  }
  throw new Error(`规则库文件未找到：${relative}；已尝试 ${tried.length} 个位置，最近一处为 ${tried[0] ?? ''}`)
}

/** Build the roster from configuration plus any per-call additions. */
export function rosterFrom(config: ConfigShape, extra: Partial<Roster> = {}): Roster {
  return {
    authorNames: [...config.authorNames, ...(extra.authorNames ?? [])],
    institutionNames: [...config.institutionNames, ...(extra.institutionNames ?? [])],
    advisorNames: [...config.advisorNames, ...(extra.advisorNames ?? [])],
    allowList: [...config.allowList, ...(extra.allowList ?? [])],
  }
}
/**
 * Read the material into a source the reader understands.
 *
 * Text and JSON come through as text. Any other extension is read as bytes and
 * handed to the reader, which knows how to unpack a docx and which refuses a PDF
 * rather than inventing page numbers for it.
 */
async function readMaterial(
  file: string | undefined,
  text: string | undefined,
  signal: AbortSignal,
): Promise<MaterialSource> {
  if (file !== undefined && file.trim() !== '') {
    const path = resolve(file)
    signal.throwIfAborted()
    const extension = (path.split('.').pop() ?? '').toLowerCase()
    if (extension === 'txt' || extension === 'md' || extension === 'json' || extension === 'yaml' || extension === 'yml') {
      const content = await readFile(path, { encoding: 'utf8', signal })
      return { target: path, text: content }
    }
    const bytes = await readFile(path, { signal })
    return { target: path, bytes }
  }
  if (text !== undefined && text.trim() !== '') return { target: '(内联材料)', text }
  throw new MaterialError('必须提供 file 或 text 之一')
}

/** Render one roster list for the tool description, trimming long lists. */
function describeRoster(values: readonly string[]): string {
  if (values.length === 0) return '未配置'
  if (values.length <= 3) return values.join('、')
  return `${values.slice(0, 3).join('、')} 等 ${values.length} 项`
}

/**
 * Register the proposal form and anonymity checker.
 *
 * Registration is an effect: `ctx.tools.register` returns the disposer that
 * removes the tool when this plugin unloads, which is what keeps the plugin
 * hot-reloadable.
 *
 * @param ctx - plugin context, with `tools` already available.
 * @param config - validated configuration.
 */
export function apply(ctx: Context, config: ConfigShape): () => void {
  const configured = rosterFrom(config)
  return ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description:
        '按声明的规则库核对基金申请书文本与电子文档属性中的身份信息，以及材料长度与形式审查清单。' +
        '本工具只列出材料与所引条款之间的字面差异，供人工复核，不作出任何定性结论。' +
        `当前配置的身份词：申请人姓名 ${describeRoster(configured.authorNames)}；` +
        `依托单位 ${describeRoster(configured.institutionNames)}；导师 ${describeRoster(configured.advisorNames)}。` +
        '未配置身份词时，匿名相关检查会逐条列在 skipped 中。' +
        '.docx 直接读取正文与文档属性；.pdf 不由本工具解析，需先用你信任的工具抽取文本。',
      parameters: {
        file: { type: 'string', description: '材料文件绝对路径（.docx / .txt / .md / .json）。与 text 二选一。' },
        text: { type: 'string', description: '内联正文文本，或形如 {"text"|"lines":…,"metadata":{…}} 的 JSON。' },
        authorNames: {
          type: 'array',
          items: { type: 'string' },
          description: '本次调用追加的申请人姓名，会与配置中的名单合并。',
        },
        institutionNames: {
          type: 'array',
          items: { type: 'string' },
          description: '本次调用追加的依托单位名称。',
        },
        advisorNames: {
          type: 'array',
          items: { type: 'string' },
          description: '本次调用追加的导师姓名。',
        },
        allowList: {
          type: 'array',
          items: { type: 'string' },
          description: '本次调用追加的例外词（命中也不报）。',
        },
        rulesFile: { type: 'string', description: '覆盖配置中的规则库路径（相对插件包根或绝对路径）。' },
        only: {
          type: 'array',
          items: { type: 'string' },
          description: '只执行这些规则 id；留空表示执行全部规则。',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            plugin: { type: 'string' },
            target: { type: 'string' },
            checkedAt: { type: 'string' },
            rulesetVersion: { type: 'string' },
            summary: {
              type: 'object',
              additionalProperties: false,
              properties: {
                error: { type: 'integer' },
                warn: { type: 'integer' },
                info: { type: 'integer' },
              },
            },
            issueCount: { type: 'integer' },
            skippedCount: { type: 'integer' },
            markdown: { type: 'string' },
            reportJson: { type: 'string' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: (value as { markdown: string }).markdown }],
      },
      timeoutMs: config.timeoutMs,
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const relative = args.rulesFile !== undefined && args.rulesFile.trim() !== '' ? args.rulesFile : config.rulesFile
        const [source, ruleset] = await Promise.all([
          readMaterial(args.file, args.text, exec.signal),
          loadRulesetFile(resolvePackageFile(relative)),
        ])
        exec.signal.throwIfAborted()
        const input = parseMaterial(source)
        const only = (args.only ?? []).length > 0 ? (args.only as string[]) : config.onlyRules
        const report = runCheck(input, ruleset, {
          plugin: name,
          checkedAt: new Date().toISOString(),
          disabledRules: config.disabledRules,
          onlyRules: only,
          skipNotes: config.skipNotes === '' ? undefined : config.skipNotes,
          roster: rosterFrom(config, {
            authorNames: (args.authorNames ?? []) as string[],
            institutionNames: (args.institutionNames ?? []) as string[],
            advisorNames: (args.advisorNames ?? []) as string[],
            allowList: (args.allowList ?? []) as string[],
          }),
        })
        return buildView(report)
      },
    }),
  )
}
