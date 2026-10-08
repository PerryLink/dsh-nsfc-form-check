# dsh-nsfc-form-check — 国家自然科学基金申请书形式审查与身份线索词提示，按本机构名单核对

`dsh-nsfc-form-check` 读取一份国家自然科学基金申请书——正文行、电子文档属性，以及本机构自己配置的身份词名单——按版本化规则库核对：名单是否已配置，配置的申请人、依托单位与导师姓名在正文中及指定行范围内的出现位置，标题、作者、单位、「最后修改者」四个文档属性各写了什么，材料是否超出使用方配置的长度限额，配置的形式审查项与重复申请披露说明是否齐备，导师姓名是否已按当年指南要求如实填写，以及是否出现配置的涉密或敏感词。每一条发现都写出它所依据的条款，并标明该条款是直接规定、原则推论还是本机构配置；每一项无法执行的检查都以 `skipped` 连同原因列出。

## 它回答什么问题

| 你会问 | 它怎么答 |
|---|---|
| 申请人姓名名单没填，匿名检查是不是就直接通过了？ | 不是。`authorNames`、`institutionNames`、`advisorNames` 三项都为空时，最先报出的就是 `NF-001`，其余需要名单的匿名检查逐条以 `skipped` 连同原因列出。所以发现列表为空永远不等于没有问题——下结论前先看 `NF-001` 与 `skipped` 条目。 |
| 正文里出现了一个与申请人同姓的合作者。 | `NF-002` 按行逐字匹配配置的 `authorNames`，因此同姓同名、常见姓氏、引用他人姓名都可能命中。命中只是技术性提示——《国家自然科学基金条例》(国务院令第796号) 第二十一条要求评审方保密，并未禁止正文出现姓名——已经人工确认无需处理的词可以加入 `allowList`。 |
| 文档属性里的作者栏有名字，会报出来吗？需要先配名单吗？ | 会报，且不必先配名单。`NF-006` 在 `authorNames` 为空时也会报出非空的作者字段，配了名单则进一步说明是否命中申请人姓名；`NF-005`、`NF-007`、`NF-008` 需要身份词名单，没有名单即进 `skipped`。这四条都只读文档属性，对正文内容不作任何判断。 |
| 页数和字数限额是我自己填的，它会告诉我材料超长吗？ | 只在你自己填的限额内报。`NF-010` 出厂时 `maxLines` 与 `maxChars` 均未配置，本条进 `skipped`，因为限额逐年变化且按项目类型不同；填好之后，超出配置的段落行数或字数会被报出。`maxLines` 统计的是抽取后的段落行数，不等同于排版页数，不能当页数用。 |
| 本机构科研管理部门要求的形式审查项，材料里都有吗？ | `require` 未配置时 `NF-011` 报自己进 `skipped`，没有清单时它不假装知道清单是什么。配置之后，它按你写的 `match` 字面匹配，把找不到的条目报出。它只核对字样是否存在，不判断该栏是否填写正确，也不判断签字是否真实。 |
| 我们是在去年申请基础上重新提交，必须写披露说明吗？ | `NF-012` 需要两项配置同时到位：`markerPatterns` 用来识别你所在模板对重复申请或延续申请的表述，`requiredDisclosure` 列出必须披露的内容。缺任一项本条进 `skipped`；配了标记但材料中没有该声明时，本条报告为不适用。它不假定披露内容的写法，也不判定这份材料究竟是否属于重复申请。 |

## 依据的标准

| 文件 | 文号 | 引用它的规则 |
|---|---|---|
| 《国家自然科学基金条例》 | 国务院令第796号 | NF-001, NF-002, NF-003, NF-004, NF-005, NF-006, NF-007, NF-008, NF-009, NF-010, NF-011, NF-012, NF-013, NF-014, NF-015 |
| 《2026 年度国家自然科学基金项目指南·申请规定》 | 2026 年度（逐年更新） | NF-014, NF-015 |

**Boundary:** this plugin checks an **NSFC proposal's text and electronic document properties** and
reports the identity clues it finds, alongside the length and form-review items a deployment
configures. It is not `dsh-rulefile-check` (which audits the legality of a regulatory document), not
`dsh-policy-brief-draft` (which drafts a policy explainer), and not `dsh-review-reply-check` (which
tracks reviewer comments). It reads one proposal and reports literal matches against cited clauses.

> ### ⚠️ Read this before using the anonymity checks
>
> **There is no current national provision that forbids an applicant's name, institution or advisor
> from appearing in an NSFC proposal.** Three independent texts were read in full for this plugin —
> 《国家自然科学基金条例》(国务院令第796号), the 2026 年度《项目指南·申请规定》, and the 2019 年度
> guidelines — and none contains 匿名, 盲审, 活页, or any "must not appear" wording about identity.
> The regulation does not contain the word 匿名 at all. Its **avoidance** clause (第二十条) requires a
> reviewer from the applicant's own legal entity to recuse, which presupposes that the system knows
> the applicant's institution — the opposite of an anonymous process.
>
> So every finding this plugin makes about a name or an institution is a **technical observation for
> a human to weigh**, labelled 身份线索词 and never phrased as a violation. The plugin is useful for a
> research-office self-check, and it is **wrong to use it as a compliance gate**. Two rules go further
> and cite the guidance verbatim: `NF-014` checks that the advisor's name **is** filled in, because the
> yearly guidelines require it, and `NF-015` checks 涉密与敏感信息, which is the one "must not appear"
> requirement that really exists — and its object is classified information, not identity.

## Compatibility

| 项目 | 状态 |
|---|---|
| Harness | 对等版本范围 `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` —— 已实测同时接受 `0.2.0-rc.2` 与 `0.2.1-alpha.1`。**刻意不声明 `engines.dsh`**：它没有任何读取者，也无法拒装任何宿主 |
| Node | `^22.19.0 || >=24.0.0` |
| 平台 | 全平台（纯 ESM；无原生代码、无联网、不调用模型） |
| 工具模式 | `native` / `ptc` / `both` 均可；批量校验整个目录时建议 `ptc`，schema 成本只付一次 |

## What it does

规则表、字段说明与行为细节见 [README.md](README.md#what-it-does)（英文主版本）。本插件只列出材料与所引条款之间的字面差异，并对无法执行的检查在 `skipped` 中逐项说明。

## Install

```sh
dsh plugin --profile <name> add dsh-nsfc-form-check
dsh --profile <name> --dump-config | grep 'dsh-nsfc-form-check'
```

## Configuration

全部可调参数都在 `src/config.ts` 的 Schemastery schema 中，只改 `cordis.yml` 即可生效，无需改代码；逐条阈值在 `rules/` 下的规则库文件里。

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `rulesFile` | string | `rules/nsfc-form-check.yaml` | 规则库文件路径，相对插件包根目录 |
| `disabledRules` | string[] | `[]` | 要停用的规则 id 列表；每条都会出现在 `skipped` 中 |
| `onlyRules` | string[] | `[]` | 只执行这些规则 id；留空表示执行全部规则 |
| `skipNotes` | string | `""` | 附加到每条 `skipped` 说明后的备注 |
| `authorNames` | string[] | `[]` | 要检索的申请人姓名 |
| `institutionNames` | string[] | `[]` | 要检索的依托单位与院系名称 |
| `advisorNames` | string[] | `[]` | 要检索的导师姓名 |
| `allowList` | string[] | `[]` | 即使命中也要忽略的词语 |
| `timeoutMs` | number | `120000` | 工具协作式超时预算（毫秒） |

## Material format

支持 JSON 与 YAML。完整字段示例见 [README.md](README.md#material-format)（英文主版本）。字段在读取层是可选的，由检查引擎校验，因此部分导出的材料会产生"缺项"类差异，而不是让程序崩溃。

## Rule sources

规则数据与代码分离，每条规则都带文件名、文号、按原文自身编号体系的条款号、逐字摘录与来源地址。加载期强制：摘录必须是真实引文且不少于八个字符；依据仅为原则性条款（`kind: derived-from-principle`，严重级上限 `warn`）或本机构配置（`kind: institutional-configuration`，上限 `info`）的检查不得标为 `error`。夸大依据的规则库会在加载期失败，而不会产出一份看起来很有底气的报告。

核验中确认的边界与"刻意没有作出的结论"见 [README.md](README.md#rule-sources)（英文主版本）与随包的 `rules/evidence/` 目录。

## Troubleshooting

- **插件装上了但工具不出现**：确认 `main` 指向 `lib/index.mjs` 且 `pnpm run build` 已生成该文件；`main` 写错会让加载器静默跳过该条目。
- **`dsh plugin add` 报版本不兼容**：peer 范围覆盖 `0.1.x` 与 `0.2.x`；若运行时在其之外，可显式豁免：`dsh plugin --profile <name> allow-version <包名@版本> --dsh-version <runtime> --accept-risk`
- **某条规则没有执行**：查看 `skipped` 数组，其中写明了规则 id 与原因。
- **`check` 报 `manifest-peers` 失败**：静态检查器比对的是一份早于 0.2 世代的硬编码 peer 范围；安装期的 peer 校验以运行时为准。这是 `dsh-plugin-dev` 的已知上游问题。
- **时间看起来偏移**：全部计算都是对输入字符串做墙上时钟运算，不做时区换算。

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
node ../scripts/sync-shared.mjs dsh-nsfc-form-check
```

第 4 项把 `../_shared` 的共享件同步进 `src/shared/`；每次改动共享件后都要重跑。

## License

[Apache License 2.0](LICENSE) © 2026 dsh-nsfc-form-check contributors.
