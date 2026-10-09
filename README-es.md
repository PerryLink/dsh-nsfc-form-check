# dsh-nsfc-form-check — Revisión formal de una solicitud al NSFC y aviso de indicios de identidad según el listado de la institución

[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-en.svg)](https://dsh.market/)

`dsh-nsfc-form-check` lee una solicitud al NSFC —sus líneas de texto, las propiedades electrónicas del documento y el listado de términos de identidad de la propia institución— y contrasta ese material con un paquete de reglas versionado: si hay un listado configurado, en qué líneas del cuerpo y dentro de qué rango de líneas configurado aparecen los términos de solicitante, institución y director que usted configuró, qué llevan las propiedades de título, autor, empresa y última modificación, si el material cabe en el límite de extensión que fijó el despliegue, si están presentes los elementos de revisión formal y la declaración de solicitud repetida que usted configuró, si el nombre del director está cumplimentado como exigen las guías anuales, y si aparece algún término clasificado o sensible configurado. Cada hallazgo nombra la cláusula de la que procede e indica si esa cláusula es un requisito directo, un principio o una configuración local, y toda comprobación que no pudo ejecutarse figura en `skipped` con su motivo.

## Cómo se ve la salida

![Terminal demo of dsh-nsfc-form-check: real output over its NF-009 fixture](https://raw.githubusercontent.com/PerryLink/dsh-nsfc-form-check/main/docs/assets/dsh-nsfc-form-check-demo.png)

Salida real de este plugin sobre su propio fixture de prueba `NF-009` — no es un montaje. El paquete de reglas no inventa citas, así que cada hallazgo nombra la cláusula aplicada y advierte que su texto no se obtuvo.

## Qué responde

| Usted pregunta | Qué responde |
|---|---|
| Nadie rellenó el listado de nombres de solicitantes. ¿La revisión de identidad pasa sin más? | No. `NF-001` es lo primero que se informa cuando `authorNames`, `institutionNames` y `advisorNames` están vacíos, y cada comprobación de identidad que necesita esos términos figura en `skipped` con su motivo. Una lista de hallazgos vacía nunca significa que no hubiera nada mal: lea `NF-001` y las entradas de `skipped` antes de concluir nada. |
| En el cuerpo aparece un coautor con el mismo apellido que el solicitante. | `NF-002` compara literalmente los `authorNames` configurados, línea por línea, así que un homónimo, un apellido común o la cita del trabajo de otro investigador pueden coincidir. El hallazgo es solo un aviso técnico — 《国家自然科学基金条例》(国务院令第796号) 第二十一条 exige confidencialidad a los evaluadores y no prohíbe que un nombre aparezca en el cuerpo — por lo que un término ya revisado puede añadirse a `allowList`. |
| La propiedad de autor lleva un nombre. ¿Se informa y hace falta configurar antes un listado? | Sí se informa, y no hace falta listado. `NF-006` no necesita roster: con `authorNames` vacío sigue informando de cualquier propiedad de autor no vacía, y con roster configurado dice si el valor coincide con un nombre de solicitante. `NF-005`, `NF-007` y `NF-008` sí necesitan una lista de términos de identidad y sin ella entran en `skipped`. Las cuatro leen únicamente las propiedades, así que no dicen nada del cuerpo del texto. |
| Los límites de páginas y palabras los puse yo. ¿Me dirá que la solicitud es demasiado larga? | Solo dentro del límite que usted fijó. `NF-010` sale con `maxLines` y `maxChars` sin configurar y entra en `skipped`, porque esos límites cambian cada año y según el tipo de proyecto; una vez rellenados, informa del número de párrafos extraídos o del total de caracteres que los supera. `maxLines` cuenta párrafos extraídos, no páginas maquetadas, así que no equivale a un número de páginas. |
| ¿Estaban en el material todos los elementos de revisión formal que pide nuestra oficina de investigación? | `NF-011` se informa en `skipped` hasta que se configure `require`, y sin lista no pretende conocerla. Una vez configurada, compara literalmente sus frases `match` e informa de las que no encuentra. Comprueba que la frase esté presente, no que la casilla esté bien rellenada ni que la firma sea auténtica. |
| Volvemos a presentar la solicitud del año pasado. ¿Debe constar la nota de declaración? | `NF-012` necesita a la vez `markerPatterns`, que reconocen la redacción de su plantilla para una solicitud repetida o de continuación, y `requiredDisclosure`, que enumera lo que debe declararse. Con cualquiera de los dos sin configurar entra en `skipped`; cuando los marcadores están configurados pero no se encuentra la declaración, informa de que esta regla no es aplicable. Nunca supone una redacción de la declaración ni decide que la solicitud sea realmente repetida. |

## Normas que sigue

| Documento | Número | Reglas que lo citan |
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

| Superficie | Estado |
|---|---|
| Harness | Rango de peers `>=0.1.2-rc.1 <0.2.0 \|\| >=0.2.0-0 <0.3.0` — verificado para aceptar tanto `0.2.0-rc.2` como `0.2.1-alpha.1`. **No se declara `engines.dsh`**: no tiene lector y no puede rechazar ningún host |
| Node | `^22.19.0 || >=24.0.0` |
| Plataformas | Todas (ESM puro; sin código nativo, sin red, sin llamada al modelo) |
| Modo de herramienta | Funciona en `native`, `ptc` y `both`; para un directorio completo use `ptc` |

## What it does

La tabla de reglas, los campos y el comportamiento detallado están en [README.md](README.md#what-it-does) (versión principal en inglés). El plugin sólo enumera divergencias literales frente a las cláusulas citadas e indica en `skipped` cada comprobación que no pudo ejecutarse.

## Install

```sh
dsh plugin --profile <name> add dsh-nsfc-form-check
dsh --profile <name> --dump-config | grep 'dsh-nsfc-form-check'
```

## Configuration

Todos los parámetros ajustables viven en el esquema Schemastery de `src/config.ts`, por lo que se cambian desde `cordis.yml` sin tocar el código; los umbrales por regla están en el paquete de reglas bajo `rules/`.

| Clave | Tipo | Predeterminado | Descripción |
|---|---|---|---|
| `rulesFile` | string | `rules/nsfc-form-check.yaml` | Ruta del paquete de reglas, relativa a la raíz del paquete |
| `disabledRules` | string[] | `[]` | Ids de reglas que se dejan de ejecutar; cada una aparece en `skipped` |
| `onlyRules` | string[] | `[]` | Ejecutar solo estas reglas; vacío ejecuta todas |
| `skipNotes` | string | `""` | Nota añadida a cada motivo de `skipped` |
| `authorNames` | string[] | `[]` | Nombres de solicitantes que se buscan |
| `institutionNames` | string[] | `[]` | Nombres de instituciones y unidades que se buscan |
| `advisorNames` | string[] | `[]` | Nombres de asesores que se buscan |
| `allowList` | string[] | `[]` | Términos que se ignoran aunque coincidan |
| `timeoutMs` | number | `120000` | Presupuesto de tiempo de espera cooperativo de la herramienta |

## Material format

Acepta JSON o YAML. El ejemplo completo de campos está en [README.md](README.md#material-format) (versión principal en inglés). Los campos son opcionales en la capa de lectura y los valida el motor, de modo que una exportación parcial produce hallazgos sobre lo que falta en lugar de un fallo.

## Rule sources

Los datos de las reglas están separados del código: cada regla lleva documento, número, cláusula en la numeración propia de la fuente, extracto literal y URL de origen. El cargador impone que el extracto sea una cita real de al menos ocho caracteres y que una comprobación basada sólo en un principio general (`kind: derived-from-principle`, tope `warn`) o en una política local (`kind: institutional-configuration`, tope `info`) nunca se declare `error`.

Los límites verificados y las conclusiones deliberadamente **no** afirmadas están en [README.md](README.md#rule-sources) (versión principal en inglés) y en `rules/evidence/`.

## Troubleshooting

- **El plugin se instala pero la herramienta no aparece**: compruebe que `main` resuelve a `lib/index.mjs` y que `pnpm run build` lo generó.
- **`dsh plugin add` rechaza el paquete**: la faixa de peers cubre `0.1.x` y `0.2.x`; fuera de ella, conceda una exención explícita con `dsh plugin --profile <name> allow-version <pkg@ver> --dsh-version <runtime> --accept-risk`.
- **Una regla no se ejecutó**: lea el arreglo `skipped`.
- **`check` informa `manifest-peers` como fallo**: es un problema conocido de `dsh-plugin-dev`; el runtime aplica la compatibilidad al instalar.
- **Los horarios parecen desplazados**: toda la aritmética es de hora local sobre las cadenas entregadas.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm test
pnpm run build
node ../scripts/sync-shared.mjs dsh-nsfc-form-check
```

El último comando copia el kit compartido de `../_shared` a `src/shared/`; vuelva a ejecutarlo tras cada cambio compartido.

## License

[Apache License 2.0](LICENSE) © 2026 dsh-nsfc-form-check contributors.
