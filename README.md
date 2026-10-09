# dsh-nsfc-form-check — NSFC proposal form review and identity-clue prompting against the institution's own roster

[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-en.svg)](https://dsh.market/)

`dsh-nsfc-form-check` reads one NSFC proposal — its body lines, its electronic document properties, and the institution's own roster of identity terms — and checks that material against a versioned rule pack: whether a roster is configured at all, where the configured applicant, institution and advisor terms occur in the body and inside a configured line range, what the title, author, company and last-modified-by properties carry, whether the material fits the length limit the deployment set, whether the configured form-review items and duplicate-application disclosure are present, whether the advisor's name has been filled in as the yearly guidelines require, and whether any configured classified or sensitive term appears. Every finding names the clause it came from, states whether that clause is a direct requirement, a principle or a local configuration, and every check that could not run is listed in `skipped` with its reason.

## What it looks like

![Terminal demo of dsh-nsfc-form-check: real output over its NF-009 fixture](https://raw.githubusercontent.com/PerryLink/dsh-nsfc-form-check/main/docs/assets/dsh-nsfc-form-check-demo.png)

Real output from this plugin over its own `NF-009` test fixture — not a mock-up. The rule pack ships no invented quotations, so a finding names both the clause it applied and the fact that the clause text was not obtained.

## What it answers

| You ask | What it answers |
|---|---|
| Nobody filled in the applicant name list. Does the identity checking just pass? | No. `NF-001` is the first thing reported when `authorNames`, `institutionNames` and `advisorNames` are all empty, and every identity check that needs those terms reports itself in `skipped` with its reason. An empty finding list therefore never means nothing was wrong — read `NF-001` and the `skipped` entries before drawing any conclusion. |
| A co-author with the same surname as the applicant appears in the body text. | `NF-002` matches the configured `authorNames` literally, line by line, so a namesake, a common surname or a citation of another researcher's work can all be reported. The finding is a technical prompt only — 《国家自然科学基金条例》(国务院令第796号) 第二十一条 requires confidentiality from reviewers and says nothing that forbids a name in the body — so a term you have already cleared can be added to `allowList`. |
| The author property holds a name. Is that reported, and does it need a configured list? | Yes, and no. `NF-006` does not need a roster: with `authorNames` empty it still reports any non-empty author property, and with a roster configured it says whether the value matches an applicant name. `NF-005`, `NF-007` and `NF-008` do need an identity-term list and enter `skipped` without one. All four only read the properties, so they say nothing about the body text. |
| I filled in the page and word limits myself. Will it tell me the proposal is too long? | Only within the limit you set. `NF-010` ships `maxLines` and `maxChars` unset and enters `skipped`, because those limits change every year and by project type; once you fill them in it reports the extracted paragraph count or the character total that exceeds them. `maxLines` counts extracted paragraphs, not typeset pages, so it is not the same as a page count. |
| Did the material include every form-review item our research office asks for? | `NF-011` reports itself in `skipped` until `require` is configured, and with no checklist the plugin does not pretend to know one. Once configured it matches your `match` phrases literally and reports the ones it cannot find. It checks that the phrase is present, not that the column was filled in correctly or that the signature is genuine. |
| We are re-submitting last year's proposal. Must the disclosure note be there? | `NF-012` needs both `markerPatterns`, which recognise your template's wording for a repeat or follow-on application, and `requiredDisclosure`, which lists what must be disclosed. With either unset it enters `skipped`; when the markers are configured but no declaration is found it reports that this rule does not apply. It never assumes a disclosure wording, and never decides that a proposal really is a repeat. |

## Standards it follows

| Document | Number | Cited by rules |
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

| Surface | Status |
|---|---|
| Harness | Peer range `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` — verified to accept both `0.2.0-rc.2` and `0.2.1-alpha.1`. `engines.dsh` is deliberately not declared: it has no reader and cannot reject a host |
| Node | `^22.19.0 || >=24.0.0` |
| Platforms | All (plain ESM; no native code, no network, no model call) |
| Tool mode | Works in `native`, `ptc` and `both`; for a batch of proposals use `ptc` |

## What it does

Registers the `nsfc_form_check` tool. It reads one proposal — body text, document properties, and the
institution's own roster of identity terms — applies a versioned rule pack, and returns a report in
which every finding names the clause it came from and states whether that clause is a direct
requirement, a principle, or a local configuration.

| Rule | Check | Severity | Basis kind |
|---|---|---|---|
| `NF-001` | a roster is configured, otherwise the identity checks cannot run | warn | principle |
| `NF-002` | the body mentions an applicant name | warn | principle |
| `NF-003` | the body mentions an institution name | warn | principle |
| `NF-004` | the body mentions an advisor name | warn | principle |
| `NF-005` | the document title property contains an identity clue | info | principle |
| `NF-006` | the author property is non-empty or names the applicant | info | principle |
| `NF-007` | the company property names the institution | info | principle |
| `NF-008` | the last-modified-by property names the applicant | info | principle |
| `NF-009` | identity clues inside a configured line range | info | principle |
| `NF-010` | the material fits the configured length limit | info | local |
| `NF-011` | the material contains the configured form-review items | info | local |
| `NF-012` | a repeat or follow-on proposal carries the configured disclosure | info | local |
| `NF-013` | identity clues inside a configured scope | info | principle |
| `NF-014` | the advisor's name **is** present, as the yearly guidelines require | info | local |
| `NF-015` | the material contains no configured classified term | info | local |

Rules whose thresholds are yearly or per-project-type ship **empty** on purpose. They report
themselves in `skipped` until configured, so an unfilled threshold can never read as "nothing wrong".

## Install

```sh
dsh plugin --profile <name> add dsh-nsfc-form-check
dsh --profile <name> --dump-config | grep 'dsh-nsfc-form-check'
```

## Configuration

Every tunable lives in the Schemastery schema in `src/config.ts`. The roster is the one thing this
plugin cannot work without: an identity check needs a list of the terms to look for, and that list is
institution-specific, so it stays in the deployment's own configuration rather than travelling with
the package.

| Key | Type | Default | Description |
|---|---|---|---|
| `rulesFile` | string | `rules/nsfc-form-check.yaml` | Rule-pack path, relative to the package root |
| `disabledRules` | string[] | `[]` | Rule ids to stop running; each appears in `skipped` |
| `onlyRules` | string[] | `[]` | Run only these rule ids; empty runs every rule |
| `skipNotes` | string | `""` | Note appended to every `skipped` reason |
| `authorNames` | string[] | `[]` | Applicant names to look for |
| `institutionNames` | string[] | `[]` | Institution and unit names to look for |
| `advisorNames` | string[] | `[]` | Advisor names to look for |
| `allowList` | string[] | `[]` | Terms to ignore even when they match |
| `timeoutMs` | number | `120000` | Cooperative tool timeout budget |

Rule-level parameters worth knowing:

- `NF-009` `coverLines` — how many leading lines count as the cover page. Empty means the plugin does
  not assume any institution's template.
- `NF-010` `maxLines` / `maxChars` — the length limit **for the year and project type you are filing
  under**. `maxLines` counts extracted paragraphs, which is not the same as typeset pages.
- `NF-011` `require` — your form-review item list, as `[{ label, match }]` pairs.
- `NF-012` `markerPatterns` / `requiredDisclosure` — how a repeat proposal is recognised in your
  template, and what it must disclose.
- `NF-014` `requireMention` + `advisorNames` — the inverse check, off until you enable it for the year.
- `NF-015` `secretTerms` — your confidentiality office's term list. The plugin ships none, because what
  counts as classified is defined by state secrecy rules, not by this plugin.

## Material format

Point the tool at a `.docx` and it reads the body text and the document properties itself. A `.pdf` is
**not** parsed: page-accurate extraction is a different problem with a different failure mode, and a
wrong page number is worse than none, so pass the text you extracted with your own tool. `.txt`, `.md`
and `.json` are accepted too; the JSON form carries both parts explicitly.

```json
{
  "lines": ["申请代码：H0301", "一、立项依据与研究内容", "……"],
  "metadata": { "title": "某信号通路机制研究", "author": "", "company": "", "lastModifiedBy": "" }
}
```

Matching is literal and line-oriented, so every finding carries a line number you can jump to. A term
shorter than two characters is ignored, and anything in `allowList` is ignored, because a common
surname would otherwise flood the report.

## Rule sources

Rule data lives in `rules/nsfc-form-check.yaml`. Every rule carries a document, a document number, a
clause in the source's own numbering, a verbatim excerpt and the URL the excerpt was read from. The
loader enforces that an excerpt is a real quotation of at least eight characters, and that a check
resting only on a general principle or a local policy can never be declared `error`.

Four findings shaped this pack:

1. **The regulation was revised.** 《国家自然科学基金条例》 is now **国务院令第796号** (revised
   2024-11-08, in force 2025-01-01), superseding 国务院令第487号 (2007). Clause numbers moved: the
   review-confidentiality duty is now 第二十一条, not the old 第二十四条. This pack cites only the
   current revision, and a test asserts that the superseded order number never appears.
2. **Anonymity has no legal basis**, as set out at the top of this file. The rules state this in their
   own notes so a reader of the report sees it without consulting the README.
3. **The advisor's name is *required*, not forbidden.** The yearly guidelines instruct applicants to
   fill in their graduate and postdoctoral advisor names truthfully. `NF-014` therefore checks the
   opposite of `NF-004`, and the pack explains why the two coexist.
4. **Yearly policy is configuration, not code.** Page and word limits, the itemised limits on how many
   proposals may be filed, which project types use a lump-sum budget, and the yearly list of
   non-acceptance situations all change between years; every one of them ships empty.

The full clause-verification report, including the sources that were checked and rejected, is in
`rules/evidence/clause-verification.md`.

## Troubleshooting

- **The plugin installs but the tool never appears.** Check that `main` resolves to `lib/index.mjs`
  and that `pnpm run build` produced it; a wrong `main` makes the loader skip the entry silently.
- **Every identity check is skipped.** No roster is configured. Fill in `authorNames`,
  `institutionNames` and `advisorNames`, and `NF-001` will stop reporting.
- **The report is noisy with a common surname.** Add the term to `allowList`; the plugin refuses to
  guess which matches are meaningful.
- **A `.pdf` is refused.** By design. Extract the text with a tool you trust and pass it through
  `text`, or convert the proposal to `.docx`.
- **`dsh plugin add` refuses the package as incompatible.** The peer range covers `0.1.x` and `0.2.x`;
  if your runtime sits outside it, grant an explicit exemption:
  `dsh plugin --profile <name> allow-version dsh-nsfc-form-check@0.1.0 --dsh-version <runtime> --accept-risk`
- **`check` reports `manifest-peers` as failed.** The static checker compares against a hard-coded peer
  range that predates the 0.2 line. The runtime enforces peer compatibility at install time, so the
  declared range is the correct one; this is a known upstream issue in `dsh-plugin-dev`.

## Development

```sh
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm test            # vitest, paired fixtures per rule, plus a real .docx round trip
pnpm run build       # tsdown -> lib/index.mjs + lib/index.d.mts
node ../scripts/sync-shared.mjs dsh-nsfc-form-check   # refresh src/shared from ../_shared
```

`tests/docx-fixture.ts` builds real `.docx` packages in memory (a genuine ZIP with deflated entries),
so the docx path is exercised end to end while the fixtures stay reviewable JSON.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-nsfc-form-check contributors.
