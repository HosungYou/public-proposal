# KPP prose vNext calibration and holdout evaluation

Date: 2026-08-25

## Decision tested

Can the public-report grammar measured by `jkf87/hwpx-skill` improve KPP prose without forcing procurement proposals, research-service documents, partnership briefs, work plans, and press releases into one bullet style?

The test is deterministic and artifact-based. It is not a human blind preference study and does not certify factual, visual, or submission quality.

## Frozen inputs

| Role | Artifact | SHA-256 | Authority/status | Use |
|---|---|---|---|---|
| procurement candidate | `2026_전남광주_청년_AI_솔버톤_본선운영_제안서_R06.docx` | `04c2004b25181b131043f16580481868fe4b6dfe5a53085158b7702863120fe5` | internal consultation candidate | calibration |
| partnership golden behavior | `06_부산_약국_AI_파트너십_공급브리지_전략_R05.md` | `27142997a4779de442a7a4545ce7b6afb3e358a8a9dc206becf217ff54f1d9f3` | user-designated behavior sample, not universal template or submission approval | calibration |
| official research report | `REF03_부산도서관_연구보고서.pdf` | `37a10baac163a16de9c95c6c34da04a3ef3b0e364615e063d5f9920f07778d90` | public report reference, not a proposal | representative calibration only |
| official work plan | `gyehoek-reference.hwpx` | `554470ecc730102bf6172774c2d80efa92b6ef21b714e8f55a63d78054199c6b` | public plan reference | calibration |
| official press release | `bodojaryo-reference.hwpx` | `4339d2cca34fabdf36026301f45b3c1dfd64cd0d75cebf60a78e9175793c7df3` | public press-release reference | calibration |
| evaluator proposal reference | `R21-format-reference.docx` | `e53ae35724de650c65e9d8013cbe998229b484caa1693fcd0a625482b7390102` | proposal-format reference, not a winning-proposal authority | final calibration |
| research proposal candidate | `KEITI_기관_AX_중장기_로드맵_연구용역_제안서_R20.docx` | `79767c4a361c0a59d821156cf3f2fa3aee38d58b6533741eab5505b31fb1623e` | technical QA candidate; human approval separate | frozen holdout, but closely related to R21 |
| independent proposal candidate | `KEITI_기관_AX_중장기_로드맵_제안서_최종검토본.docx` | `eed8a89b17f88c1886b0811d779a946290e963b2c4eefd5e1d09caae9c4fecbe` | prior final-review artifact; approval provenance not inferred | independent frozen holdout |

The work-plan and press-release measurements informed distinct profiles. The worksheet-like `problem-answer-reference.hwpx` was excluded because its reader task is unrelated to public proposals or research reports.

## Results

| Input/profile | Legacy slop lint | vNext profile audit | Interpretation |
|---|---|---|---|
| R06 / evaluator proposal | PASS | PASS | structure-aware DOCX extraction preserved headings, leads, notes, and analytical prose |
| R05 / partnership brief | REVIEW | PASS | removed false colon-heading findings while retaining evidence and restrained bullet checks |
| official research PDF / research analytic | REVIEW | REVIEW, non-blocking | flattened PDF produced wrapping, quotation, question, and bibliography noise; it is unsuitable as a whole-document blocking receipt |
| official work plan / public bullet | 33 length warnings | PASS with `public_plan` | measured plan items require a 90-character review threshold, not the compact 70-character threshold |
| official press release / press release | not mode-aware | PASS | complete attributed sentences and longer factual items are valid in this genre |
| R21 / evaluator proposal | PASS | PASS plus one context info | a concrete human-accountability boundary is preserved; cover, TOC, and references no longer depress analytical completeness |
| R20 / research analytic holdout | PASS | PASS plus one context info | 53 analytical paragraphs, 98.1% complete analytical endings, 54 evidence-bearing units |
| independent proposal holdout | BLOCKED | PASS | legacy correctly caught one unresolved placeholder and exact repetitions; vNext correctly found no profile-form violation |

## Findings and resulting contract

1. Mode routing is necessary. Compact public bullets, work plans, press releases, evaluator proposals, research analysis, partnership briefs, executive briefs, and issuer-locked forms cannot share one ending or length rule.
2. HWPX and DOCX are both first-class authoring sources. Their structural extraction is auditable; PDF text is a discovery or representative-sample surface unless layout-aware boundaries are restored.
3. Public-research prose legitimately uses `~다/~습니다` and nominal analytical endings such as `~함/~있음/~임`.
4. A contrast is blocking in compact promotional prose, but evaluator/research profiles treat it as contextual when it defines responsibility, scope, control, or alternatives.
5. Paragraph-completeness metrics exclude short front matter and identified reference sections. They diagnose prose depth; they do not score bibliography formatting.
6. The two linters are complementary. The legacy lint remains required for unresolved placeholders and exact repetition; the vNext audit adds genre-aware register, density, and structure checks.

## Promotion gate

The implementation is a technical promotion candidate, not a proven human-quality winner. Before replacing the installed skill, compare three anonymized excerpt pairs with one named reviewer on: directness, public-sector fit, evidence traceability, reading rhythm, and information sufficiency. A promotion receipt must retain the current installed bundle for rollback and must not reinterpret technical PASS as content, visual, or submission approval.
