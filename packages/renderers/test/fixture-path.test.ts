import { describe, expect, it } from "vitest";
import { resolveFixtureOutputDirectory } from "../scripts/paths.js";

describe("fixture artifact path", () => {
  it("resolves relative paths from the invoking project root", () => {
    expect(resolveFixtureOutputDirectory(".omo/evidence/figures", "/tmp/kpp-project")).toBe(
      "/tmp/kpp-project/.omo/evidence/figures",
    );
  });

  it("preserves an explicit absolute output path", () => {
    expect(resolveFixtureOutputDirectory("/tmp/kpp-artifacts", "/tmp/kpp-project")).toBe(
      "/tmp/kpp-artifacts",
    );
  });
});
