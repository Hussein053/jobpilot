import { assertApplicationExecutionAllowed, getExecutionPolicy } from "./execution-policy";
import { describe, expect, it } from "bun:test";

describe("server-owned execution policy", () => {
  it("is dry-run only and cannot be mutated", () => {
    expect(getExecutionPolicy()).toEqual({
      submissionMode: "DRY_RUN",
      liveSubmissionsEnabled: false,
      unrestrictedAgentsEnabled: false,
    });
    expect(Reflect.set(getExecutionPolicy(), "submissionMode", "LIVE")).toBe(false);
    expect(Reflect.set(getExecutionPolicy(), "liveSubmissionsEnabled", true)).toBe(false);
    expect(getExecutionPolicy().submissionMode).toBe("DRY_RUN");
  });

  it("always refuses application execution with an HTTP 403", () => {
    expect(assertApplicationExecutionAllowed).toThrow("DRY_RUN");
    try {
      assertApplicationExecutionAllowed();
    } catch (error) {
      expect(error).toMatchObject({ status: 403, code: "FORBIDDEN" });
    }
  });
});
