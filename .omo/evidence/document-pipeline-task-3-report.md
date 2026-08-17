# Document pipeline Task 3 — deterministic renderer evidence

Date: 2026-08-17 (Asia/Seoul)

## Scope

Implemented the owned TypeScript renderer surface only:

- `packages/renderers/src/types.ts`
- `packages/renderers/src/gantt.ts`
- `packages/renderers/src/raci.ts`
- `packages/renderers/src/framework.ts`
- `packages/renderers/src/index.ts`
- `packages/renderers/test/renderers.test.ts`

The renderers accept a closed `FigureSpec` union for Gantt, RACI, and research
framework semantic data. They emit standalone deterministic SVG and expose a
SHA-256 helper. No raster or ImageGen data is accepted as a final input.

## R08 visual provenance

The minimal fixed renderer palette and geometry vocabulary was transcribed from
the approved R08 profile at:

`/Users/hosung/work/Enaction Labs/KEITI_기관_AX_중장기_로드맵_재작성/packages/R08_InstitutionalVisualReview/vector-surface-system/surface-tokens.json`

Copied tokens: paper `#FCFCFA`, ink `#1D232B`, navy `#082F63`, secondary navy
`#234D7B`, muted `#626D79`, hairline `#C9CFD6`, surface `#F4F6F8`, strong
surface `#E8EEF5`, warning `#B96B13`, and minimum label size `8pt`. Renderer
output uses square rectangles and contains no gradient, shadow/filter, or image
element.

## Criteria and captured evidence

| Success criterion | Exact scenario and invocation | Binary observable | Captured artifact |
|---|---|---|---|
| TDD RED before production code | `npm test -- packages/renderers/test/renderers.test.ts` with only the test file present | Exit `1`; suite cannot import the absent renderer entry point | `.omo/evidence/document-pipeline-task-3-red.log` |
| Closed RACI vocabulary RED | Focused test with runtime assignment `owner` alongside valid `A` and `R` | Exit `1`; promise resolves instead of rejecting before the validation change | `.omo/evidence/document-pipeline-task-3-raci-vocabulary-red.log` |
| Gantt machine roles | Focused Vitest scenario renders axis, ordered WP rows, bars, and milestone | Exit `0`; assertions find `time-axis`, `work-package-row`, `duration-bar`, `milestone` | `.omo/evidence/document-pipeline-task-3-focused-green.log`; `.omo/evidence/document-pipeline-task-3-artifacts/gantt.svg` |
| RACI ownership/state/evidence/acceptance and reading order | Focused Vitest scenario renders actor header and one activity row | Exit `0`; visible labels and `data-owner`, `data-state`, `data-evidence-ids`, `data-acceptance` assertions pass | `.omo/evidence/document-pipeline-task-3-focused-green.log`; `.omo/evidence/document-pipeline-task-3-artifacts/raci.svg` |
| Framework reading order and semantic bindings | Focused Vitest scenario renders three declared nodes and two connectors | Exit `0`; ordered labels, connectors, ownership, evidence, and acceptance assertions pass | `.omo/evidence/document-pipeline-task-3-focused-green.log`; `.omo/evidence/document-pipeline-task-3-artifacts/framework.svg` |
| Deterministic output and hash | Focused Vitest renders identical ordered Gantt input twice and checks literal SVG equality plus Node SHA-256 equality | Exit `0`; all `10/10` scenarios pass | `.omo/evidence/document-pipeline-task-3-focused-green.log`; `.omo/evidence/document-pipeline-task-3-artifact-hashes.log` |
| Reject empty evidence, mismatched semantic family/data, raster, and ImageGen | Focused Vitest invokes `renderFigure` with each malformed input | Exit `0`; each promise rejects with the asserted contract error | `.omo/evidence/document-pipeline-task-3-focused-green.log` |
| R08 neutral, square, readable SVG | Focused Vitest asserts the literal token profile, `8pt`, and absence of gradients, filters, images, and rounded corners | Exit `0`; assertions pass | `.omo/evidence/document-pipeline-task-3-focused-green.log`; `.omo/evidence/document-pipeline-task-3-previews/` |
| Well-formed rendered SVG | `xmllint --noout .omo/evidence/document-pipeline-task-3-artifacts/*.svg` | Exit `0` for all three SVG files | `.omo/evidence/document-pipeline-task-3-svg-xml-validation.log` |
| Real render inspection | `qlmanage -t -s 1200 -o .omo/evidence/document-pipeline-task-3-previews .omo/evidence/document-pipeline-task-3-artifacts/*.svg` | Exit `0`; three non-empty PNG thumbnails produced and visually inspected for clipping and legibility | `.omo/evidence/document-pipeline-task-3-preview-generation.log`; `.omo/evidence/document-pipeline-task-3-previews/` |
| Focused tests | `npm test -- packages/renderers/test/renderers.test.ts` | Exit `0`; `1` file and `10` tests pass | `.omo/evidence/document-pipeline-task-3-focused-green.log` |
| Full repository tests | `npm test` | Exit `0`; full Vitest count recorded in log | `.omo/evidence/document-pipeline-task-3-full-test.log` |
| Repository typecheck | `npm run typecheck` | Exit `0`; TypeScript emits no diagnostics | `.omo/evidence/document-pipeline-task-3-typecheck.log` |
| Repository build | `npm run build` | Exit `0`; all root-enumerated workspaces compile | `.omo/evidence/document-pipeline-task-3-build.log` |
| Patch hygiene | `git diff --check` | Exit `0`; no whitespace errors | `.omo/evidence/document-pipeline-task-3-diff-check.log` |

## Manual artifact observations

- Gantt: the navy duration bar aligns to the declared period columns; the
  warning milestone diamond and Korean acceptance label are readable.
- RACI: actor columns remain in input order; the activity's owner, state,
  acceptance, evidence, and `A`/`R` assignments are visible without relying on
  color alone.
- Framework: node order is left-to-right as declared; straight navy connectors,
  visible edge verbs, and the neutral node surfaces preserve the R08 vocabulary.

## Limitations

- The brief makes deterministic PNG an optional later adapter boundary. This
  task emits authoritative SVG only; PNG files here are Quick Look inspection
  previews, not an evidence-bearing renderer output.
- `packages/renderers/package.json` and `packages/renderers/tsconfig.json` were
  outside the assigned file ownership and did not exist. Consequently the root
  build validates the workspaces currently enumerated by the repository build
  script, while the renderer source itself is compiled by the root typecheck.
