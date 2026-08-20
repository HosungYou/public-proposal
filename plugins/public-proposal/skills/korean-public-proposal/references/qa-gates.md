# Proposal QA gates

## G0 Authority and rights

- Authoritative notice, RFP, guide, annex, and clarification are registered with version, date, URL/path, SHA-256, and use boundary.
- External proposal wording, diagrams, or branding are not copied.
- Every visual source has a verified class, rendered page, SHA-256, rights status, inspection record, and use boundary.
- An RFP, template, evaluation result, or report is not labelled as an actual or winning proposal.

## G1 Interpretation

- Submission files, qualifications, deadlines, constraints, evaluation questions, annexes, and conflicts have locators and human owners.

## G2 Evidence lock

- Every critical factual claim is `verified` or explicitly `bounded` and has evidence IDs.
- Pending company, performance, personnel, qualification, budget, and consortium claims are blocked from the submission version.

## G3 Evaluation coverage

- Every detailed evaluation question maps to a proposal section, direct answer, evidence IDs, and page locator.

## G4 Style and originality

- No unresolved placeholders, duplicated template prose, generic hype, decorative AI figures, copied layouts, or unverified numbers.
- Every ordinary page satisfies the page contract; table-only and figure-only pages require an explicit approved exception.
- Chapter openers may use the large-title token; ordinary continuation pages keep compact headings at 12 pt or smaller and never repeat a standalone page-title shell.
- Three consecutive structurally equivalent pages are blocked unless a current issuer/accessibility exception is bound to its reference and source hash.
- Every table and figure has a number, question-led title, body callout, source/date, interpretation, and action or decision boundary.
- Product Design/ImageGen candidates were grounded with attached Korean reference pages and deterministically rebuilt before final use.

## G5 Render and file QA

- DOCX and PDF page counts agree.
- Every page is inspected at readable zoom.
- Korean glyphs, tables, figures, captions, page breaks, headers, and footers are intact.
- Fonts are present or embedded as required; Korean text is extractable.
- Figure text is at least 8 pt equivalent at insertion size; tables are at least the approved project minimum.
- Ordinary-page occupancy outside the approved range is flagged for human review; occupancy alone never decides pass/fail.
- PDF bookmarks, TOC locators, evaluation crosswalk locators, and evidence locators agree with the final rendered pages.
- Submission PDF count, filenames, total size, and openability meet the notice.
- On macOS, verify the PDF with a LibreOffice conversion that can see the actual user font library. An isolated renderer may preserve extractable Korean text while omitting visible glyph outlines when its temporary HOME cannot access installed fonts. Reject that render and rerun in the real font environment; confirm embedded fonts with `pdffonts` and rasterize the resulting PDF for page inspection.
- Run `audit_docx_integrity.py`. Caption count, DOCX drawing count, figure-ledger count, and visible rendered-figure count must agree. Required figures equal to zero, orphan image relationships, orphan media files, and zero-size drawings are blockers.
- Scan all document, style, table, header, footer, footnote, and endnote font declarations against the approved allowlist. Embedded but undeclared Arial, Helvetica, or other fallback fonts remain blockers unless an issuer-form exception is explicitly registered.
- Record the canonical surface-token path, version, SHA-256, and page-role coverage in the build manifest. A reference PDF without this binding does not prove that the surface system was applied.
- Record mode-aware architecture, reference, rendered-observation, Korean prose, figure-value, repetition, and composite audit receipts. Technical PASS remains `TECHNICAL_GATE_ONLY`.

## G6 Human approval

- Content owner, evidence owner, visual reviewer, and submission owner have approved their gates.
- After upload, download each submitted file from the procurement system and verify it again.
- A representative reviewer can locate a high-weight direct answer, its source evidence, one project card's data/KPI/stop condition/owner, and a summary-to-body claim within the approved task time and without guessing.

## G7 Reuse and regression

- The child round retains every confirmed parent requirement or records an explicit human-approved exception.
- Issuer, contract-type, universal, and project-only patterns are separated.
- A reusable candidate records source, applicability, variables, validation, and confidentiality.
- Project personnel, pricing, private evidence, and unverified claims do not enter the shared library.
- Only a human-approved candidate with all validations set to `true` is promoted.
