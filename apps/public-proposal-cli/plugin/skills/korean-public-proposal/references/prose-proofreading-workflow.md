# Fact-preserving Korean prose workflow

Use this workflow when drafting reaches editorial review or when the user asks to polish, shorten, humanize, normalize, or improve Korean public-document prose. It governs prose changes only; it does not authorize new facts, altered evidence status, redesigned official forms, or submission.

## Inputs

Resolve and record:

- the editable HWPX, DOCX, or Markdown authoring source and SHA-256;
- `documentMode`, `proseProfile`, reader task, and issuer-protected locators;
- the current evidence, claim/proof, requirement, figure, and citation ledgers;
- user-designated exemplar or project voice, if any;
- the intended pass: `clarity`, `compression`, `register`, `consistency`, or `final_copyedit`.

Do not use flattened PDF text as the mutation source. It may support bounded visual comparison after the authoring source is reviewed.

## Editorial sequence

### 1. Freeze semantic invariants

Before editing, extract a locator-level `SemanticInvariantSet` containing every:

- fact, number, unit, date, proper name, quotation, citation, and evidence locator;
- actor, responsibility, approval boundary, exception path, condition, limitation, uncertainty, and status;
- requirement answer, commitment, acceptance criterion, claim/proof ID, figure/table reference, and requested decision.

Mark issuer wording and approved quotations `protected`. Mark unresolved content `pending`; never turn it into a confirmed statement during editing.

### 2. Diagnose by reader task

For each editable unit, identify:

- the reader question and direct answer;
- the material fact or judgment carried by the unit;
- necessary evidence and qualification;
- removable repetition, abstract framing, rhetorical contrast, or delayed subject;
- whether the unit belongs as a paragraph, item, detail, conclusion, note, table, or figure explanation under the selected prose profile.

Do not shorten merely to reduce characters. Compression is useful only when the same decision-relevant meaning becomes easier to retrieve.

### 3. Revise in controlled passes

Use separate passes rather than an unconstrained rewrite:

1. `clarity`: expose actor, action, object, condition, and status; move the direct answer forward.
2. `compression`: remove duplicated framing and replace avoidable nominal padding while preserving evidence, qualifications, and decision logic.
3. `register`: apply the selected profile's endings, hierarchy, density, and restraint. Do not force evaluator or research reasoning into compact nominal bullets.
4. `consistency`: align terminology, dates, units, names, citation notation, and repeated commitments with the locked ledgers.
5. `final_copyedit`: correct spacing, punctuation, particles, parallelism, and awkward rhythm without changing scope or certainty.

One pass may produce no change. Never manufacture edits to satisfy the workflow.

### 4. Produce a change ledger

For every changed unit, record:

| Field | Meaning |
|---|---|
| `locator` | stable paragraph, page, requirement, claim, or block ID |
| `pass` | editorial pass that caused the change |
| `beforeHash` / `afterHash` | exact unit hashes |
| `preserved` | invariant IDs verified unchanged |
| `removed` | repetition or rhetoric removed, never a fact |
| `risk` | possible ambiguity, compression loss, or register trade-off |
| `reviewStatus` | `accepted`, `revised`, `reverted`, or `pending_human` |

Show material before/after text to the reviewer. A document-level summary without locators is not a sufficient editorial receipt.

### 5. Run semantic and prose gates

Block the editorial pass when any frozen invariant disappears, changes value, loses its qualification, or changes status. Then run both:

```bash
python scripts/proposal_slop_lint.py proposal.docx --out slop.json
python scripts/audit_prose_contract.py proposal.docx --profile PROSE_PROFILE --out prose-audit.json
```

The first detects placeholders and exact repetition. The second detects profile-specific form and density risks. Neither certifies factual correctness or human preference.

Review rendered pages after prose changes because line breaks, table reflow, orphaned headings, caption placement, and page density may change even when the text is semantically valid.

### 6. Human comparison and approval

For a new profile or material workflow change, prepare anonymized A/B excerpts from at least three relevant document modes. Randomize baseline and candidate positions, keep the key separate, and ask a named reviewer to judge:

- directness;
- public-sector fit;
- evidence traceability;
- reading rhythm;
- information sufficiency.

Record the choices, reasons, source hashes, key hash, evaluator role, and pass rule. A technical audit cannot set `effectivenessValidated=true`; only the recorded human comparison can do so.

## Stop rules

Revert or request human direction when an edit:

- changes a number, date, proper name, source, claim/proof link, or evidence status;
- removes a limitation, exception, dependency, approval boundary, or accountable actor;
- turns `pending`, `proposed`, or `subject to confirmation` into a commitment;
- compresses reasoning until a table or figure must be guessed at;
- normalizes issuer-protected text;
- improves rhythm by adding unsupported certainty, praise, or obligation.

Keep these receipts distinct: machine lint, AI editorial change ledger, Korean prose review, human content approval, rendered visual approval, and submission/publication approval.
