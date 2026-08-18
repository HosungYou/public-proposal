# KPP NPM Package Release Plan

> This plan is the public handoff version of the current release decision. A
> former private installer proposal is superseded.

## Goal

Publish the verified KPP package family under the `@longtable` scope from the
canonical `public-proposal` repository. The English `$public-proposal` caller
preserves proposal context; the NPM packages provide the deterministic state,
build, render, audit, approval, and release surface.

## Package family

| Order | Package | Responsibility |
| --- | --- | --- |
| 1 | `@longtable/kpp-schemas` | RFP, evidence, content, figure, and approval contracts |
| 2 | `@longtable/kpp-core` | project state, provenance, receipts, and release lineage |
| 3 | `@longtable/kpp-renderers` | deterministic SVG figure families |
| 4 | `@longtable/kpp-audits` | content, source, render, DOCX, and release gates |
| 5 | `@longtable/kpp-cli` | `kpp` command and guarded workflow transitions |

All packages in the release share one semver version. Workspace dependencies
must resolve to that exact version before packing.

## Release gates

1. `npm whoami` identifies the authorized publisher and the registry is
   `https://registry.npmjs.org/`.
2. Every package manifest points to
   `https://github.com/HosungYou/public-proposal`.
3. `npm run typecheck`, `npm test`, and `npm run build` pass from a clean
   checkout.
4. Each tarball contains only its package README, metadata, compiled `dist`,
   and required runtime dependencies. It must not contain TypeScript or Python
   source, customer documents, private evidence, `.env`, `.npmrc`, credentials,
   or local absolute paths.
5. Tarballs are inspected before publication and retained with their SHA-256
   hashes for the release record.
6. Publication runs in dependency order with `--access public`; the root
   private workspace is never published.
7. The published CLI is installed from the registry into a fresh temporary
   prefix and `kpp --help` plus `kpp doctor --json` are executed.

## Commands

```bash
npm whoami
npm config get registry
npm run typecheck
npm test
npm run build

npm pack --workspace @longtable/kpp-schemas --pack-destination <release-dir> --json
npm pack --workspace @longtable/kpp-core --pack-destination <release-dir> --json
npm pack --workspace @longtable/kpp-renderers --pack-destination <release-dir> --json
npm pack --workspace @longtable/kpp-audits --pack-destination <release-dir> --json
npm pack --workspace @longtable/kpp-cli --pack-destination <release-dir> --json

npm publish --workspace @longtable/kpp-schemas --access public
npm publish --workspace @longtable/kpp-core --access public
npm publish --workspace @longtable/kpp-renderers --access public
npm publish --workspace @longtable/kpp-audits --access public
npm publish --workspace @longtable/kpp-cli --access public
```

Replace `<release-dir>` with a temporary directory outside the repository.
Never commit tarballs, `.npmrc`, authentication output, or customer evidence.

## Post-publish verification

For every package, verify `name`, `version`, repository URL, tarball URL, and
integrity through `npm view`. Then install the CLI from the registry into a
fresh prefix and run:

```bash
<prefix>/bin/kpp --help
<prefix>/bin/kpp doctor --json
```

A registry version and a technical audit pass are not human approval or
submission readiness. A project still requires issuer-specific requirements,
evidence binding, substantive Korean prose, page-level inspection, DOCX/PDF
integrity, and named human approval.
