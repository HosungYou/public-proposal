# HWPX Surface Authority Contract

## Decision

`korean-public-proposal` remains the only user-facing skill. The pinned
`jkf87/hwpx-skill` snapshot is an internal, byte-preserved production engine.
Every build must bind one project design authority and one governed content
model before producing HWPX or DOCX. A DOCX tool may implement OOXML mechanics,
but it may not introduce an independent visual design.

## Failure being prevented

The G-Solverthon contract package generated HWPX with the pinned upstream
engine and generated DOCX independently with a generic KPP template. The
reported parity covered normalized text and page count only, so it could not
detect lost cover furniture, typography, tables, figures, approval boxes, or
section grammar. The 부산 약국 AI partnership R05 reference was inspected in
the session but was never bound as a build input.

## Required behavior

1. A locked build request declares a `designAuthority` containing an immutable
   ID, source classification, permitted use boundary, source bytes and SHA-256,
   rendered reference pages, and the template/profile IDs that implement it.
2. KPP rejects a build when the design authority is missing, its source bytes
   drift, its manifest is not receipt-bound, or its template/profile identities
   do not match the build request.
3. HWPX and DOCX derivatives declare the same design-authority ID and governed
   content hash. A generic standalone DOCX builder cannot claim parity.
4. A derivative-parity receipt checks content identity, page count, page image
   identity/visual distance, page geometry, font families, table count, figure
   count, and required project-specific furniture. Unavailable HWPX rendering
   remains `review_candidate`; structural validation cannot impersonate visual
   parity.
5. `public-proposal doctor` verifies packaged, installed, registered, and active
   Codex cache skill bytes. Same-version byte drift is a blocker.
6. Release identity binds Git commit, npm package version and `gitHead`, plugin
   version, bundle manifest, installation receipt, and active cache hash.
7. The upstream snapshot remains unmodified. Promotional/footer text from the
   upstream skill is never relayed through the single KPP surface.

## R05 project boundary

The attached R05 is a user-approved private visual golden reference, not a
universal public template. Store only its project-local path, SHA-256, rendered
page evidence, distilled design contract, and permitted `visual_language_only`
use boundary in the contract package. Do not publish the private DOCX in npm or
the public Git repository.

The rebuilt quotation, statement of work, and draft contract must inherit the
approved R05 design grammar while adapting content structure to each document
type. Human review of every rendered page is required before any GitHub or npm
release claim.

