import Schema from '@deepseek-ai/schemastery'

/**
 * Every tunable lives here so an operator can change behaviour from
 * `cordis.yml` without editing code (the family's "no hard-coded tunables"
 * redline). The rule pack itself is data as well and can be pointed elsewhere.
 *
 * The roster is the one configuration this plugin cannot work without: an
 * anonymity check needs a list of the names it is looking for. It stays in the
 * deployment's own configuration because the list is institution-specific and,
 * unlike a rule pack, should not travel with the package.
 */
export interface Config {
  /** Rule-pack path relative to the plugin package root. */
  rulesFile: string
  /** Rule ids disabled for this deployment. */
  disabledRules: string[]
  /** When non-empty, only these rule ids run. */
  onlyRules: string[]
  /** Extra note appended to every `skipped` reason. */
  skipNotes: string
  /** Applicant names to look for in the material. */
  authorNames: string[]
  /** Institution and unit names to look for in the material. */
  institutionNames: string[]
  /** Supervisor or mentor names to look for in the material. */
  advisorNames: string[]
  /** Terms to ignore even when they match, for example a common surname. */
  allowList: string[]
  /** Tool timeout budget in milliseconds. */
  timeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  rulesFile: Schema.string()
    .default('rules/nsfc-form-check.yaml')
    .description('规则库文件路径（相对插件包根目录）。替换该文件即可切换规则集版本。'),
  disabledRules: Schema.array(Schema.string())
    .default([])
    .description('要停用的规则 id 列表；停用的规则会出现在报告的 skipped 中。'),
  onlyRules: Schema.array(Schema.string())
    .default([])
    .description('只执行这些规则 id；留空表示执行全部规则。'),
  skipNotes: Schema.string()
    .default('')
    .description('附加到每条 skipped 说明后的备注，例如标注本机构实施细则。'),
  authorNames: Schema.array(Schema.string())
    .default([])
    .description('申请人姓名名单。留空时匿名相关检查只能逐条报为未执行，不会静默通过。'),
  institutionNames: Schema.array(Schema.string())
    .default([])
    .description('依托单位与院系名称名单。'),
  advisorNames: Schema.array(Schema.string())
    .default([])
    .description('导师姓名名单。'),
  allowList: Schema.array(Schema.string())
    .default([])
    .description('命中也不报的例外词，例如常见姓氏或学科常用词。'),
  timeoutMs: Schema.number()
    .default(120000)
    .description('工具协作式超时预算（毫秒）。'),
})
