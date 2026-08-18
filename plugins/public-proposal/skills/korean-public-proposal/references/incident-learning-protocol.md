# Proposal incident learning protocol

Convert verified production failures into regression protection. Do not promote a project fact, visual preference, or one-off workaround as a universal rule.

## Incident record

Store one machine-readable record per failure with these required fields:

- `incident_id`
- `artifact_path` and `artifact_version`
- `symptom`
- `root_cause`
- `escaped_gate`
- `invariant`
- `regression_fixture`
- `automated_test`
- `scope`: `issuer`, `contract_type`, `universal`, or `project_only`
- `promotion_status`: `candidate`, `approved`, `deprecated`
- `human_owner`

## Promotion sequence

1. Reproduce the failure with the smallest safe fixture.
2. Write a failing regression test.
3. Implement the minimum validator or production correction.
4. Confirm the broken fixture fails and the valid fixture passes.
5. Run the full Skill test suite and a real artifact audit.
6. Record applicability and confidentiality.
7. Promote only the reusable invariant, validator, and sanitized fixture after human approval.

## Required DOCX invariants

- Text rewriting preserves `w:drawing`, `w:pict`, `w:object`, equations, bookmarks, fields, and hyperlinks.
- Figure captions, drawing objects, figure-ledger records, and visible rendered figures have equal counts unless an approved exception is recorded.
- Image relationships and media files are referenced; zero-size drawings and orphan media block release.
- Font embedding and font allowlist conformance are separate gates.
- Every build records the canonical surface-token path, version, SHA-256, and page-role coverage.
- A validator may not report PASS when a required count is zero, a required artifact is missing, or a downstream human approval is absent.
