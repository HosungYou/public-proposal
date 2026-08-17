# KPP Codex Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the governed KPP workflow as an installable personal-marketplace Codex plugin that delegates every authoritative action to the `kpp` CLI.

**Architecture:** A minimal plugin bundles one concise skill, reference material, assets, and a safe CLI shim. It never computes PASS or writes receipts; it reads structured CLI output and guides the user through allowed transitions.

**Tech Stack:** Codex plugin manifest, Agent Skills format, Python plugin-creator validators, TypeScript CLI from the core plan.

**Spec:** `docs/superpowers/specs/2026-08-17-kpp-product-design.md`

## Global Constraints

- Plugin ID is `korean-public-proposal`; display name is `KPP 제안서 컴파일러`.
- Plugin version begins at `0.1.0`; developer name is `Enaction Labs`.
- The plugin must not duplicate state authority or release logic.
- The personal marketplace path is `~/.agents/plugins/marketplace.json`.
- New-thread installation tests are required before the plugin is called usable.

---

### Task 1: Scaffold the canonical repository plugin

**Files:**
- Create: `plugins/korean-public-proposal/.codex-plugin/plugin.json`
- Create: `plugins/korean-public-proposal/skills/korean-public-proposal/SKILL.md`
- Create: `plugins/korean-public-proposal/scripts/`
- Create: `plugins/korean-public-proposal/assets/`

**Interfaces:**
- Consumes: plugin ID and product metadata from the spec.
- Produces: a locally valid plugin directory before marketplace registration.

- [ ] **Step 1: Write a manifest contract test**

```py
def test_plugin_manifest_delegates_to_skill():
    data = json.loads(MANIFEST.read_text())
    assert data["name"] == "korean-public-proposal"
    assert data["version"] == "0.1.0"
    assert data["skills"] == "./skills/"
```

- [ ] **Step 2: Run the test and verify manifest absence failure**

Run: `pytest tests/plugin/test_manifest.py -v`
Expected: FAIL because the plugin does not exist.

- [ ] **Step 3: Scaffold with the canonical plugin creator**

Run from `/Users/hosung/.codex/skills/.system/plugin-creator`:

```bash
python3 scripts/create_basic_plugin.py korean-public-proposal \
  --path '/Users/hosung/work/Enaction Labs/KPP/plugins' \
  --with-skills --with-scripts --with-assets
```

Set manifest interface values from the approved spec; omit MCP and apps.

- [ ] **Step 4: Validate manifest and run its contract test**

Run: `python3 /Users/hosung/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/korean-public-proposal && pytest tests/plugin/test_manifest.py -v`
Expected: PASS.

- [ ] **Step 5: Commit the plugin shell**

```bash
git add plugins tests/plugin
git commit -m "feat: scaffold KPP Codex plugin"
```

### Task 2: Convert the skill into a thin CLI controller

**Files:**
- Modify: `plugins/korean-public-proposal/skills/korean-public-proposal/SKILL.md`
- Copy: governed references from `/Users/hosung/.codex/skills/korean-public-proposal/references/` to `plugins/korean-public-proposal/skills/korean-public-proposal/references/`
- Copy: approved reusable assets from `/Users/hosung/.codex/skills/korean-public-proposal/assets/` to `plugins/korean-public-proposal/skills/korean-public-proposal/assets/`
- Create: `tests/plugin/test_skill_contract.py`

**Interfaces:**
- Consumes: `kpp status --json`, CLI error envelope, and allowed next actions.
- Produces: explicit skill behavior that always begins with `kpp doctor` and `kpp status` for execution tasks.

- [ ] **Step 1: Write a failing skill contract test**

```py
def test_skill_never_self_declares_release():
    text = SKILL.read_text()
    assert "kpp status --json" in text
    assert "Only `kpp release`" in text
    assert "Never write PASS or receipt JSON directly" in text
```

- [ ] **Step 2: Run the test and verify failure against scaffold content**

Run: `pytest tests/plugin/test_skill_contract.py -v`
Expected: FAIL because the scaffold skill lacks the CLI contract.

- [ ] **Step 3: Write the concise skill and preserve references as subordinate guidance**

Keep trigger metadata broad enough for Korean public proposals, but make the body route all mutations through CLI commands. Keep Product Design/ImageGen boundaries and issuer authority order.

- [ ] **Step 4: Validate the skill and plugin**

Run: `python3 /Users/hosung/.codex/skills/.system/skill-creator/scripts/quick_validate.py plugins/korean-public-proposal/skills/korean-public-proposal && python3 /Users/hosung/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/korean-public-proposal && pytest tests/plugin -q`
Expected: PASS.

- [ ] **Step 5: Commit the controller skill**

```bash
git add plugins/korean-public-proposal tests/plugin
git commit -m "feat: route proposal workflow through KPP CLI"
```

### Task 3: Safe CLI shim and structured error translation

**Files:**
- Create: `plugins/korean-public-proposal/scripts/kpp`
- Create: `plugins/korean-public-proposal/scripts/format-kpp-error.mjs`
- Create: `tests/plugin/test_shim.py`

**Interfaces:**
- Consumes: installed `kpp` executable and argument vector.
- Produces: unchanged exit code and JSON stdout; Korean diagnostic on stderr when the executable is absent.

- [ ] **Step 1: Write shim tests for installed and missing CLI**

```py
def test_missing_cli_is_actionable(tmp_path):
    result = run_shim([], path=tmp_path)
    assert result.returncode == 127
    assert "kpp doctor" in result.stderr
```

- [ ] **Step 2: Run shim tests and verify failure**

Run: `pytest tests/plugin/test_shim.py -v`
Expected: FAIL because the shim is absent.

- [ ] **Step 3: Implement argument-safe process delegation**

Use `exec` with quoted positional arguments; do not build a shell command string. Return CLI JSON without rewriting authoritative fields.

- [ ] **Step 4: Run shim and plugin tests**

Run: `pytest tests/plugin -q`
Expected: PASS.

- [ ] **Step 5: Commit the shim**

```bash
git add plugins/korean-public-proposal tests/plugin
git commit -m "feat: delegate plugin actions to installed KPP CLI"
```

### Task 4: Personal marketplace installation and validation

**Files:**
- Create through creator command: `~/.agents/plugins/marketplace.json`
- Create through creator command: `~/plugins/korean-public-proposal/`
- Create: `scripts/sync-personal-plugin.mjs`
- Create: `tests/plugin/marketplace-snapshot.json`

**Interfaces:**
- Consumes: validated canonical plugin directory.
- Produces: personal marketplace entry and installed copy with `AVAILABLE`, `ON_INSTALL`, and `Productivity` verified.

- [ ] **Step 1: Capture the expected marketplace entry in a test fixture**

```json
{
  "name": "korean-public-proposal",
  "source": {"source": "local", "path": "./plugins/korean-public-proposal"},
  "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
  "category": "Productivity"
}
```

- [ ] **Step 2: Create the default personal installation shell and marketplace entry**

Run from `/Users/hosung/.codex/skills/.system/plugin-creator`:

```bash
python3 scripts/create_basic_plugin.py korean-public-proposal \
  --with-skills --with-scripts --with-assets --with-marketplace
```

Expected: creates `~/plugins/korean-public-proposal` and the `personal` marketplace entry without modifying the canonical repository plugin.

- [ ] **Step 3: Implement and run deterministic sync from the canonical plugin**

`scripts/sync-personal-plugin.mjs` validates both absolute roots, copies only `.codex-plugin`, `skills`, `scripts`, and `assets`, and refuses symlinks or paths outside the two exact plugin directories.

Run: `node scripts/sync-personal-plugin.mjs`
Expected: installed plugin contents match the canonical plugin except for an approved cachebuster suffix.

- [ ] **Step 4: Validate marketplace and read its name**

Run: `python3 /Users/hosung/.codex/skills/.system/plugin-creator/scripts/read_marketplace_name.py && python3 /Users/hosung/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/korean-public-proposal`
Expected: marketplace name `personal`; validation PASS.

- [ ] **Step 5: Install and verify in a new Codex conversation**

Run: `codex plugin add korean-public-proposal@personal`
Expected: installation succeeds. In a new conversation, `$korean-public-proposal` calls `kpp status --json` before claiming project state.

- [ ] **Step 6: Record installation evidence and commit repo-owned evidence only**

```bash
git add scripts/sync-personal-plugin.mjs tests/plugin docs
git commit -m "test: verify KPP personal marketplace installation"
```
