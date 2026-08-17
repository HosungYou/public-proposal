import { describe, expect, it } from "vitest";
import root from "../../package.json";

describe("workspace", () => {
  it("declares the KPP workspaces", () => {
    expect(root.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(root.engines.node).toBe(">=22 <27");
  });
});
