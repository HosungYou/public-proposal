# KPP NPM Installer and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a public `@enaction-labs/kpp` installer that exposes the verified `kpp` command without shipping KPP core source or customer data.

**Architecture:** A public npm package contains a small JavaScript launcher and a macOS arm64 executable built from the private product workspace. Publication is gated by tarball inspection, clean-environment installation, npm identity, scope ownership, and explicit final publish confirmation.

**Tech Stack:** npm 11.17.0, Node 22-26, Node Single Executable Application tooling, PyInstaller 6.22.1, Vitest, shell-free `child_process.spawnSync`.

**Spec:** `docs/superpowers/specs/2026-08-17-kpp-product-design.md`

## Global Constraints

- Package name is `@enaction-labs/kpp`; initial version is `0.1.0`.
- The package is public but proprietary; it must not include TypeScript/Python core source.
- v0.1 supports verified macOS arm64 only and must fail clearly elsewhere.
- NPM publication is forbidden until `npm whoami` succeeds and scope ownership is verified.
- `npm publish --access public` is the only external publication action and requires the inspected tarball.

---

### Task 1: Public installer package contract

**Files:**
- Create: `dist/npm/kpp/package.json`
- Create: `dist/npm/kpp/bin/kpp.mjs`
- Create: `dist/npm/kpp/LICENSE.txt`
- Create: `dist/npm/kpp/README.md`
- Create: `tests/distribution/npm-installer.test.ts`

**Interfaces:**
- Consumes: bundled executable at `vendor/darwin-arm64/kpp`.
- Produces: npm binary mapping `kpp -> ./bin/kpp.mjs`.

- [ ] **Step 1: Write installer contract tests**

```ts
it("publishes only the launcher documentation license and vendor binary", async () => {
  const files = await npmPackFileList("dist/npm/kpp");
  expect(files).toEqual(expect.arrayContaining([
    "package/bin/kpp.mjs", "package/README.md", "package/LICENSE.txt",
    "package/vendor/darwin-arm64/kpp"
  ]));
  expect(files.some((p) => p.endsWith(".ts") || p.endsWith(".py"))).toBe(false);
});
```

- [ ] **Step 2: Run the distribution test and verify package absence failure**

Run: `npm test -- tests/distribution/npm-installer.test.ts`
Expected: FAIL because the installer package does not exist.

- [ ] **Step 3: Implement package metadata and platform-aware launcher**

Set `name`, `version`, `license: "SEE LICENSE IN LICENSE.txt"`, `publishConfig.access: "public"`, and `files` allowlist. The launcher checks `process.platform === "darwin"` and `process.arch === "arm64"`, then invokes the binary with `spawnSync` and inherited stdio.

- [ ] **Step 4: Run installer contract tests**

Run: `npm test -- tests/distribution/npm-installer.test.ts`
Expected: PASS after a fixture binary is supplied.

- [ ] **Step 5: Commit installer contract**

```bash
git add dist/npm tests/distribution
git commit -m "feat: define public KPP npm installer"
```

### Task 2: Reproducible macOS executable build

**Files:**
- Create: `scripts/build-macos-arm64.mjs`
- Create: `scripts/check-binary-contents.mjs`
- Modify: root `package.json`
- Create: `tests/distribution/binary.test.ts`

**Interfaces:**
- Consumes: compiled CLI entrypoint and Python worker from the document pipeline.
- Produces: `dist/npm/kpp/vendor/darwin-arm64/kpp`, `dist/npm/kpp/vendor/darwin-arm64/kpp-docx-worker`, and `dist/build-manifest.json` with source commit and SHA-256.

- [ ] **Step 1: Write a binary smoke test**

```ts
it("runs doctor from the packaged binary", () => {
  const result = spawnSync(binary, ["doctor", "--json"], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).code).toBe("KPP_OK");
});
```

- [ ] **Step 2: Run the binary test and verify missing binary failure**

Run: `npm test -- tests/distribution/binary.test.ts`
Expected: FAIL because the executable is absent.

- [ ] **Step 3: Build the Node executable and package the worker without source files**

Use the Node SEA flow supported by the selected Node release for `kpp`. Build `kpp-docx-worker` with `pyinstaller==6.22.1 --onefile`. Bundle templates and font-license metadata into a versioned resource archive; do not include `.ts`, `.py`, customer files, KEITI claims, npm credentials, or local absolute paths. Record every packaged file and its hash.

- [ ] **Step 4: Run binary smoke and content scans**

Run: `npm run build:macos-arm64 && npm test -- tests/distribution/binary.test.ts && node scripts/check-binary-contents.mjs`
Expected: PASS; content scan reports zero forbidden source or customer paths.

- [ ] **Step 5: Commit reproducible build scripts, not generated binaries**

```bash
git add scripts package.json package-lock.json tests/distribution .gitignore
git commit -m "build: package KPP macOS installer binary"
```

### Task 3: Tarball and clean-install release gate

**Files:**
- Create: `scripts/audit-npm-tarball.mjs`
- Create: `tests/distribution/clean-install.test.ts`
- Create: `docs/release/npm-release-checklist.md`

**Interfaces:**
- Consumes: `npm pack --json` output.
- Produces: audited `.tgz`, file inventory, SHA-256, and clean-install receipt.

- [ ] **Step 1: Write a clean-install test using a temporary npm prefix**

```ts
it("installs globally into an empty prefix and runs kpp doctor", async () => {
  const result = await installTarballIntoTempPrefix(tarball);
  expect(result.doctor.code).toBe("KPP_OK");
});
```

- [ ] **Step 2: Run the clean-install test and verify missing tarball failure**

Run: `npm test -- tests/distribution/clean-install.test.ts`
Expected: FAIL because no audited tarball exists.

- [ ] **Step 3: Implement pack audit and forbidden-content rules**

Reject `.ts`, `.py`, `.env`, `.npmrc`, `node_modules`, customer paths, KEITI source material, source maps, absolute home paths, tokens, and files outside the package allowlist.

- [ ] **Step 4: Pack, audit, and install from the tarball**

Run: `mkdir -p dist/npm/tarballs && npm pack ./dist/npm/kpp --pack-destination dist/npm/tarballs --json && node scripts/audit-npm-tarball.mjs && npm test -- tests/distribution/clean-install.test.ts`
Expected: PASS and a receipt containing tarball SHA-256.

- [ ] **Step 5: Commit release gates**

```bash
git add scripts tests/distribution docs/release
git commit -m "test: gate KPP npm tarball publication"
```

### Task 4: NPM authentication and scope preflight

**Files:**
- Create: `docs/release/npm-preflight.json` after successful checks; it must contain no token.

**Interfaces:**
- Consumes: interactive npm authentication and registry access.
- Produces: verified account, scope permission, package availability, and registry URL.

- [ ] **Step 1: Authenticate the CLI interactively**

Run: `npm login`
Expected: browser or terminal authentication completes without storing credentials in the repository.

- [ ] **Step 2: Verify identity and registry**

Run: `npm whoami && npm config get registry`
Expected: an authorized publisher identity and `https://registry.npmjs.org/`.

- [ ] **Step 3: Verify `enaction-labs` scope publication rights**

Run: `npm access list packages enaction-labs --json`
Expected: command succeeds for the authenticated account. If the scope is not controlled, stop before publication and create or transfer the organization through npm's official UI.

- [ ] **Step 4: Verify the target version is unpublished**

Run: `npm view @enaction-labs/kpp@0.1.0 version`
Expected: `E404` before first publication; any existing version blocks reuse and requires a new semver.

- [ ] **Step 5: Record nonsecret preflight evidence**

Write account name, registry, scope result, package/version availability, timestamp, and tarball hash to `docs/release/npm-preflight.json`; exclude tokens, cookies, and `.npmrc` contents.

### Task 5: Publish and post-publish verification

**Files:**
- Create: `docs/release/npm-publish-receipt.json`

**Interfaces:**
- Consumes: authenticated account and the exact audited tarball SHA-256.
- Produces: public `@enaction-labs/kpp@0.1.0` and a post-publish install receipt.

- [ ] **Step 1: Reconfirm package identity and tarball hash**

Run: `npm pkg get name version --prefix dist/npm/kpp && shasum -a 256 dist/npm/tarballs/enaction-labs-kpp-0.1.0.tgz`
Expected: `@enaction-labs/kpp`, `0.1.0`, and the hash recorded in preflight.

- [ ] **Step 2: Publish the exact tarball**

Run: `npm publish dist/npm/tarballs/enaction-labs-kpp-0.1.0.tgz --access public`
Expected: npm reports `+ @enaction-labs/kpp@0.1.0`.

- [ ] **Step 3: Verify registry metadata**

Run: `npm view @enaction-labs/kpp@0.1.0 name version dist.integrity dist.tarball --json`
Expected: name and version match; integrity and tarball URL are present.

- [ ] **Step 4: Install from the registry into a clean temporary prefix**

Run: `KPP_INSTALL_PREFIX=$(mktemp -d /tmp/kpp-npm-install.XXXXXX) && npm install --global --prefix "$KPP_INSTALL_PREFIX" @enaction-labs/kpp@0.1.0 && "$KPP_INSTALL_PREFIX/bin/kpp" doctor --json`
Expected: installation succeeds and doctor returns `KPP_OK` on supported macOS arm64.

- [ ] **Step 5: Record publication and commit nonsecret evidence**

```bash
git add docs/release/npm-publish-receipt.json
git commit -m "chore: record KPP npm publication"
```
