# Regression fixture provenance

These are technical regression inputs only. They contain no customer narrative,
submission claims, personal data, or approval signal. Runtime DOCX, PDF, PNG,
SVG, manifests, and receipts are assembled from the listed copied templates in
`tests/regression/fixture-harness.ts`, then audited through the public
`auditProposal` API. They are deliberately written into temporary directories
and are not checked in.

| Fixture / source | Source SHA-256 | Fixture SHA-256 | Classification | Use boundary |
| --- | --- | --- | --- | --- |
| `known-bad/c11/c11-lineage.json` redacted metadata derived from a private project manifest (source path withheld) | `819e4fb8590aa74e5e7732c02ad92d05d3306a9047ee4020e0fe2dfd3a9521fc` | `e0016135878b9de5431230a835338bbd19ad1d782a69af394fa78eeba8b37381` | `project_only` | Rejected lineage metadata only; never an official/public source. |
| `known-bad/c11/figures/gantt-spec.json` minimal reproduction | `e642671b2629853dffec6be25c83369bc6e73bf87b435e9bd5cf940bdb4bb3b8` (`packages/audits/test/audits.test.ts`, structural construction reference) | `334875249e6700db94c5c310aeaa94bb3d1c39a95c293319e0652e1b9312d492` | `project_only` | Synthetic semantic schedule only; runtime replaces Gantt roles with generic boxes. |
| `known-bad/c11/ooxml/**` minimal reproduction | `74d9a83b73edad25a4d0e679a7a3b73b9acc147dbeca8360230f57256102111b` (`workers/docx-python/assets/Korean Public Proposal A4 v1.docx`, observed table/type geometry boundary) | `[Content_Types] d421db63459cec48fd052860f831a381185c8ce4b174d3e38b7e7853e7046889; .rels dcf9d81747168416f639620327151fa0091ef920a4a407c312d139776b37f5fa; document 13323ea160c3060c01c6573832e471d5202171354b4cf91818e0272137bef325; styles 937944d88ba3a4de357b32999595bfe34e2d0f4e738db4592acffaa5133ed5ab; document.rels 48806ea160c3060c01c6573832e471d5202171354b4cf91818e0272137bef325` | `project_only` | New Korean-neutral OOXML reproduction; no issuer pages or prose copied. |
| `valid/r08-reference/surface-tokens.json` synthetic public-proposal surface profile | `synthetic-profile` | `4c0853d1b7eb1817f54fb193f20995362cc4657f99ddc943e6fa75b3f6a9f725` | `visual_reference_only` | Geometry/token authority only; not evidence for any proposal claim. |
| `valid/r08-reference/ooxml/word/media/image1.png` synthetic neutral visual surface | `synthetic-asset` | `generated-public-fixture` | `visual_reference_only` | Technical raster fixture only; contains no issuer branding, project claim, or customer evidence. |
| `valid/r08-reference/{fixture.json,figures/gantt-spec.json,ooxml/{[Content_Types].xml,_rels/**,word/{document.xml,styles.xml,_rels/**}}}` sanitized minimal reproduction | `e642671b2629853dffec6be25c83369bc6e73bf87b435e9bd5cf940bdb4bb3b8` (`packages/audits/test/audits.test.ts`, verified OOXML construction reference) | `fixture 1a011a52a05c2bc8800f3a7cfb4a1bf76f20643fdf8de0997d2309492015e5df; gantt 5b46ff9f25de434bbc3df8eef59ad7fb1f235873fc58f283438b3035b4ab4fee; document fabeb02ccd87c398ee648a8fd615d1a3a3ee18fe182cceda857ca849387111f8; styles 7239dc80c403a615ad0ce4ac7899035ea864097459065b5c6195ed256cbbb6de; content-types 1b73b04dfd7dbcb33dffdf59be7e98f626d93418df49fe991c1ce526a9fe8ff0; root rels dcf9d81747168416f639620327151fa0091ef920a4a407c312d139776b37f5fa; document rels db5cb9e7e3d18efeef2077e4dcd8b9d9d1c927097468a335ff36d5ccbeceefe2` | `visual_reference_only` | Synthetic Korean-neutral OOXML structure validates technical geometry, relationship binding, and the separately enumerated visual media. |

`PASS` for this fixture means the synthetic bytes satisfy a technical audit. It
does not assert that any institution's proposal is current, accurate, visually
approved for a submission, or human-approved.

## Anonymized pharmacy private-partnership fixture

`valid/pharmacy-private-partnership` is a fully synthetic, anonymized KPP vNext
regression fixture. It contains no real institution, person, address, contact
detail, contract amount, or asserted operational fact. Its three source records
separate `official_fact`, `proposal_design`, and `pending_consultation`. The two
pharmacy known-bad fixtures are mutation manifests over that base and exist only
to prove title hierarchy, topology repetition, and decorative-evidence gates.
