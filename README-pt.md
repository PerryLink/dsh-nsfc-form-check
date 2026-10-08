# dsh-nsfc-form-check — Revisão formal de uma candidatura ao NSFC e aviso de indícios de identidade segundo a lista da instituição

`dsh-nsfc-form-check` lê uma candidatura ao NSFC —as suas linhas de texto, as propriedades eletrónicas do documento e a lista de termos de identidade da própria instituição— e confronta esse material com um pacote de regras versionado: se existe uma lista configurada, em que linhas do corpo e dentro de que intervalo de linhas configurado aparecem os termos de requerente, instituição e orientador que configurou, o que consta nas propriedades de título, autor, empresa e última modificação, se o material cabe no limite de extensão fixado pela instalação, se estão presentes os itens de revisão formal e a declaração de candidatura repetida que configurou, se o nome do orientador está preenchido como exigem as orientações anuais, e se aparece algum termo classificado ou sensível configurado. Cada constatação nomeia a cláusula de onde vem e indica se essa cláusula é um requisito direto, um princípio ou uma configuração local, e toda a verificação que não pôde ser executada consta em `skipped` com o seu motivo.

## O que ele responde

| Você pergunta | O que ele responde |
|---|---|
| Ninguém preencheu a lista de nomes de requerentes. A verificação de identidade passa sem mais? | Não. `NF-001` é a primeira coisa reportada quando `authorNames`, `institutionNames` e `advisorNames` estão vazios, e cada verificação de identidade que precisa desses termos consta em `skipped` com o seu motivo. Uma lista de constatações vazia nunca significa que nada estava errado — leia `NF-001` e as entradas de `skipped` antes de tirar qualquer conclusão. |
| No corpo aparece um coautor com o mesmo apelido do requerente. | `NF-002` compara literalmente os `authorNames` configurados, linha a linha, pelo que um homónimo, um apelido comum ou a citação do trabalho de outro investigador podem coincidir. A constatação é apenas um aviso técnico — 《国家自然科学基金条例》(国务院令第796号) 第二十一条 exige confidencialidade aos avaliadores e nada proíbe que um nome apareça no corpo — por isso um termo já esclarecido pode ser acrescentado a `allowList`. |
| A propriedade de autor tem um nome. É reportado, e é preciso configurar antes uma lista? | É reportado, e não é precisa lista. `NF-006` não necessita de roster: com `authorNames` vazio continua a reportar qualquer propriedade de autor não vazia, e com roster configurado diz se o valor corresponde a um nome de requerente. `NF-005`, `NF-007` e `NF-008` precisam de uma lista de termos de identidade e sem ela entram em `skipped`. As quatro leem apenas as propriedades, pelo que nada dizem sobre o corpo do texto. |
| Os limites de páginas e palavras fui eu que preenchi. Vai dizer-me que a candidatura é demasiado longa? | Apenas dentro do limite que você definiu. `NF-010` sai com `maxLines` e `maxChars` por configurar e entra em `skipped`, porque esses limites mudam todos os anos e conforme o tipo de projeto; depois de preenchidos, reporta o número de parágrafos extraídos ou o total de caracteres que os excede. `maxLines` conta parágrafos extraídos, não páginas paginadas, pelo que não equivale a um número de páginas. |
| Estavam no material todos os itens de revisão formal que o nosso gabinete de investigação pede? | `NF-011` reporta-se em `skipped` até `require` ser configurado, e sem lista não finge conhecê-la. Depois de configurada, compara literalmente as suas frases `match` e reporta as que não encontra. Verifica que a frase está presente, não que a casela esteja bem preenchida nem que a assinatura seja autêntica. |
| Vamos reapresentar a candidatura do ano passado. A nota de declaração tem de constar? | `NF-012` precisa ao mesmo tempo de `markerPatterns`, que reconhecem a redação do seu modelo para uma candidatura repetida ou de continuação, e de `requiredDisclosure`, que enumera o que deve ser declarado. Com qualquer um deles por configurar entra em `skipped`; quando os marcadores estão configurados mas a declaração não é encontrada, reporta que esta regra não é aplicável. Nunca supõe uma redação da declaração nem decide que a candidatura seja realmente repetida. |

## Normas que segue

| Documento | Número | Regras que o citam |
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

| Superfície | Estado |
|---|---|
| Harness | Faixa de peers `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` — verificada para aceitar tanto `0.2.0-rc.2` quanto `0.2.1-alpha.1`. **`engines.dsh` não é declarado**: não tem leitor e não pode recusar nenhum host |
| Node | `^22.19.0 || >=24.0.0` |
| Plataformas | Todas (ESM puro; sem código nativo, sem rede, sem chamada ao modelo) |
| Modo de ferramenta | Funciona em `native`, `ptc` e `both`; para um diretório inteiro use `ptc` |

## What it does

A tabela de regras, os campos e o comportamento detalhado estão em [README.md](README.md#what-it-does) (versão principal em inglês). O plugin apenas lista divergências literais frente às cláusulas citadas e indica em `skipped` cada verificação que não pôde ser executada.

## Install

```sh
dsh plugin --profile <name> add dsh-nsfc-form-check
dsh --profile <name> --dump-config | grep 'dsh-nsfc-form-check'
```

## Configuration

Todos os parâmetros ajustáveis ficam no esquema Schemastery de `src/config.ts`, portanto mudam pelo `cordis.yml` sem editar código; os limites por regra ficam no pacote de regras sob `rules/`.

| Chave | Tipo | Padrão | Descrição |
|---|---|---|---|
| `rulesFile` | string | `rules/nsfc-form-check.yaml` | Caminho do pacote de regras, relativo à raiz do pacote |
| `disabledRules` | string[] | `[]` | Ids de regras a desativar; cada uma aparece em `skipped` |
| `onlyRules` | string[] | `[]` | Executar apenas estas regras; vazio executa todas |
| `skipNotes` | string | `""` | Nota acrescentada a cada motivo de `skipped` |
| `authorNames` | string[] | `[]` | Nomes de solicitantes a procurar |
| `institutionNames` | string[] | `[]` | Nomes de instituições e unidades a procurar |
| `advisorNames` | string[] | `[]` | Nomes de orientadores a procurar |
| `allowList` | string[] | `[]` | Termos a ignorar mesmo quando coincidem |
| `timeoutMs` | number | `120000` | Orçamento de tempo limite cooperativo da ferramenta |

## Material format

Aceita JSON ou YAML. O exemplo completo de campos está em [README.md](README.md#material-format) (versão principal em inglês). Os campos são opcionais na camada de leitura e validados pelo motor, de modo que uma exportação parcial gera achados sobre o que falta em vez de falhar.

## Rule sources

Os dados das regras ficam separados do código: cada regra traz documento, número, cláusula na numeração própria da fonte, trecho literal e URL de origem. O carregador impõe que o trecho seja citação real de pelo menos oito caracteres e que uma verificação baseada apenas em princípio geral (`kind: derived-from-principle`, teto `warn`) ou em política local (`kind: institutional-configuration`, teto `info`) nunca seja declarada `error`.

Os limites verificados e as conclusões deliberadamente **não** afirmadas estão em [README.md](README.md#rule-sources) (versão principal em inglês) e em `rules/evidence/`.

## Troubleshooting

- **O plugin instala mas a ferramenta não aparece**: confirme que `main` resolve para `lib/index.mjs` e que `pnpm run build` o gerou.
- **`dsh plugin add` recusa o pacote**: a faixa de peers cobre `0.1.x` e `0.2.x`; fora dela, conceda isenção explícita com `dsh plugin --profile <name> allow-version <pkg@ver> --dsh-version <runtime> --accept-risk`.
- **Uma regra não executou**: leia o arranjo `skipped`.
- **`check` informa `manifest-peers` como falha**: problema conhecido do `dsh-plugin-dev`; o runtime aplica a compatibilidade na instalação.
- **Os horários parecem deslocados**: toda a aritmética é de hora local sobre as cadeias fornecidas.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
node ../scripts/sync-shared.mjs dsh-nsfc-form-check
```

O último comando copia o kit compartilhado de `../_shared` para `src/shared/`; execute-o novamente após cada alteração compartilhada.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-nsfc-form-check contributors.
