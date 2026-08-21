# Rendered visual QA protocol

Use three independent layers. A producer's `PASS`, a DOCX geometry check, and a rendered-page check are different observations and must not be collapsed into one status.

## 1. Surface geometry

The surface contract must declare the table width and every expected column-width vector. The auditor verifies fixed `tblLayout`, table width, `tblGrid`, cell widths, header repetition, fills, alignment, and the render-manifest binding. A table that looks aligned in one viewer but has no byte-bound geometry receipt is not fixed.

## 2. Rendered coordinates

Render the PDF at print dimensions and keep the page PNGs. Parse text and image boxes and block page-boundary violations, text/image overlap, missing required text, invalid page aspect ratios, and density outside the project contract. A screenshot cropped by a viewer is not evidence of document overflow; compare the full page dimensions first.

## 3. Deterministic figure safety

For every SVG, check the viewBox, estimated text boxes, connector-label boxes, and node rectangles. Block text outside the viewBox, text collisions inside a node, and any material connector-label overlap with a node fill. Same-row skipped edges must route above the row; adjacent-edge labels must use a clear band rather than the node centerline. Keep figure family and semantic-value declarations bound to the page claim/evidence ledger.

## 4. Frontier/reportability review

The automated frontier slice checks continuation title size, surface diversity, figure-family diversity, and repeated topology. A human reviewer then opens every full page at print size and a zoomed crop of every table/figure and records:

- page edges, header/footer, and crop safety;
- table width, column alignment, row height, header/body contrast, and no hidden or split text;
- figure labels, arrows, legends, captions, and evidence locators;
- whether the page answers its evaluator question and adds a decision, proof, or operational handoff;
- whether the page is too sparse, too dense, or structurally repetitive.

The output must retain `humanReviewRequired=true`. Use `review_candidate` until a named reviewer signs the checklist. Technical visual PASS never authorizes publication, npm release, or external submission by itself.
