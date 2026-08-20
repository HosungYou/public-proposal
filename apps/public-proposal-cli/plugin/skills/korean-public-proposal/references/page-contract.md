# Evaluator-centered page contract

Every ordinary proposal page must contain the required fields below. Cover, contents, chapter opener, official annex, and scanned evidence pages must declare their exception type.

The contract does not require a large page title. Ordinary continuation pages use running context and compact headings at 12 pt or smaller. Page boundaries follow chapter structure and measured content, not every subsection.

## Required fields

1. `evaluation_question`: the RFP question or decision the page answers.
2. `direct_answer`: one concise answer, not a topic label.
3. At least one of `mechanism_or_rule` or `evidence_interpretation`.
4. `deliverable_or_acceptance`: an output, criterion, KPI, gate, or observable result.
5. `claim_ids` and `proof_ids`, or an explicit `bounded`/`blocked` state.

Strong pages also include owner, timing, assumptions, risk, next action, and exact locators.

## Table and figure shell

Every table or figure requires:

- sequential number;
- question-led title;
- a body sentence that calls it out;
- reading axis or legend;
- source and reference date;
- interpretation boundary;
- conclusion, action, or decision after it.

Do not accept `title + table` or `title + figure` as a complete ordinary page.

## Evaluator navigation

The front crosswalk uses `evaluation code/score -> direct answer -> final page -> claim ID -> proof ID -> status`. A high-weight criterion receives proportionately more answer, mechanism, and evidence space, subject to issuer limits.

## QA heuristics

- Flag ordinary pages below 60% or above 88% content-area occupancy for review. Do not fail from occupancy alone.
- Flag figures below 8 pt equivalent at insertion size.
- Flag tables and figures without their shell.
- Flag final locators that differ between TOC, bookmarks, crosswalk, and evidence register.
- Fail when three consecutive pages have structurally equivalent title, lead, surface, and judgment regions without a verified source-bound issuer/accessibility exception.
- Fail submission mode when a critical page contains an unresolved placeholder, unbound proof, or blocker.
