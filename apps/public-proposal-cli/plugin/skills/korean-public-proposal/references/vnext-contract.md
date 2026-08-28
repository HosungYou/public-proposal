# KPP vNext document contract

Use this reference as the searchable human contract for the schemas and mode policy enforced by KPP. Issuer annex authority remains higher; a project-specific fact never enters this reusable contract.

## Closed document modes

`documentMode` is exactly one of the following values. Each mode has its own required page roles, audit slices, and release artifact allowlist.

| `documentMode` | Reader decision | Required role families |
|---|---|---|
| `public_procurement` | Does the answer satisfy and prove the scored requirement? | executive summary, evaluation crosswalk, requirement response, delivery control |
| `research_service` | Is the question answerable by a sound, traceable method? | research question, method, evidence plan, limitations, utilization |
| `private_partnership` | Is there mutual value and an operable choice for both parties? | mutual value, party roles, operating model, options, next decision |
| `internal_decision` | Which option should an accountable owner approve? | decision request, alternatives, tradeoffs, risks, owner approval |
| `document_restyle` | Was presentation changed without silent content mutation? | source inventory, content ledger, accessibility, mutation report, acceptance |

Each mode also resolves a `proseProfile` through `prose-profile-registry.md`. Mode selects the reader task; prose profile selects the register and density contract. Store both values in the project profile and prose audit receipt. Issuer-protected text remains outside normalization scope.

A schema-v1 project is read-only until an operator crosses the explicit `kpp migrate --apply` boundary with `kpp migrate PROJECT --apply`. Migration creates a backup and receipt. Plan, build, audit, and release must not auto-migrate or silently infer a mode.

## PageArchitectureManifest

The manifest declares `projectId`, `documentMode`, `modePolicyVersion`, `architectureStatus`, chapters, sections, and pages. Every page declares at least:

- `pageId`, `chapterId`, `sectionId`, `pageRole`, and `surfaceTemplateId`;
- `titleScope`, optional `titlePointSize`, and `continuation`;
- `dominantSurface`, `surfaceVisibility`, claim/proof/reference/figure IDs;
- evaluator question and direct answer where the role requires them;
- continuity links and a source-bound `issuerOverride` only when applicable.

`architectureStatus` must be `complete` before build. `staged` is planning state, not a build or release exception.

## Title-role policy

| Page role | `titleScope` | Default title treatment |
|---|---|---|
| cover | `cover` | cover title only |
| chapter opener | `chapter` | a large title may use the governed 20.5 pt chapter token |
| ordinary first/continuation page | `section`, `surface`, or `none` | running chapter/section context plus a compact heading; continuation heading <=12 pt |
| official annex/form | issuer-declared | preserve the verified issuer form and record its authority |

An ordinary page is not a standalone `Page title` shell. A page builder must not require a large title, subtitle/lead band, card body, and judgment band on every call. Start a new page for a chapter or because measured content requires it, not because a subsection ended.

Observed render data, not planned role labels, decides the audit. `titleBlocks`, `measuredHeadingPointSizes`, `surfaceFamily`, `regionFingerprints`, geometry, and continuation markers must bind to the rendered artifact SHA-256. Block three consecutive structurally equivalent pages. The only repetition exceptions are a verified issuer-mandatory form or an accessibility-required repeated instruction, bound to a current reference ID and source SHA-256.

## Evaluator traceability

The forward and reverse navigation chain is:

`requirement -> answer -> page -> claim/proof -> status`

Every final locator must agree across the table of contents, bookmark tree, evaluation crosswalk, page architecture, evidence ledger, and rendered page. Missing or conflicting links are blockers; a polished page is not evidence.

## Semantic figure value

A non-decorative figure declares `semanticValueIntent`, `decisionEffect`, `nonDuplicateOf`, `encodedVariables`, claim IDs, and evidence IDs. Permitted value intents are `data_evidence`, `causal_mechanism`, `decision_tradeoff`, and `operational_control`. It must add decision value beyond neighboring prose and tables and pass the non-decorative repetition audit.

`decorative` is an explicit exception: it carries no decision effect, encoded variable, claim, or evidence binding and cannot be used as proof. Figure family, renderer, and topology never substitute for semantic value.

## Korean prose and approval boundaries

The authoring plan includes a section-level `ProseBudget`: reader question, direct answer, importance or evaluation weight, required claim/proof/qualification/citation coverage, permitted surface mix, and observed rendered density. Character and page estimates are calibrated from the issuer geometry and approved exemplars after an initial render; they are not universal quotas.

A Korean prose reviewer preserves facts, numbers, dates, names, citations, locators, claim/proof IDs, and statuses. The reviewed authoring artifact is SHA-256-bound to a current `CONTENT_APPROVED` receipt before the `korean_prose_review` audit slice can pass.

Keep these decisions separate:

1. machine audit result;
2. AI-assisted edit or suggestion;
3. Korean prose reviewer finding;
4. human content approval;
5. human visual/exemplar approval;
6. human submission or publication approval.

No actor may convert one boundary into another. A `CompositeAuditReceipt` always declares `humanBoundary: TECHNICAL_GATE_ONLY`.

## Mode-aware receipt and release checklist

Before release, verify:

- project, `PageArchitectureManifest`, reference manifest, render observations, audit receipt, and artifacts share `projectId`, `documentMode`, and `modePolicyVersion`;
- every required mode audit slice has a current PASS receipt with exact `inputHashes`, findings, `reviewerScope`, and `artifactBindings`;
- architecture, references, render observations, evidence ledger, authoring response, and approval receipts are byte/hash-bound to the audited subjects;
- only the mode's artifact allowlist enters the release package;
- `CompositeAuditReceipt` status is PASS and its slice/input/artifact unions are exact;
- all pages were rendered and inspected for their evaluator task;
- technical PASS remains `TECHNICAL_GATE_ONLY` until named humans approve content, visual output, and submission/publication;
- npm `latest`, GitHub release, and final submission remain blocked until the final rendered exemplar is human-approved.

## Review-agent boundaries

Subagents may review independent surfaces, but they do not create facts or approve release.

| Review role | Required output |
|---|---|
| architecture reviewer | title hierarchy, continuation, page-role, and three-page topology findings |
| reference/evidence reviewer | source class, locator, hash, claim/proof target, and availability findings |
| visual/figure reviewer | rendered observation, semantic value, duplication, legibility, and deterministic-data findings |
| Korean prose reviewer | fact-preserving prose findings with reviewed locators and exclusions |
| release gate reviewer | receipt identity, required slices, allowlist, and residual human-boundary findings |

Each review records its scope, excluded locators, evidence paths, and artifact hashes. Parallel reviews may reduce latency; a final integrator must reconcile conflicts against issuer authority and the mode policy. The number of agents or a clean review is not evidence of human approval.
