import { assertFixtureUrl, fixtureControl, simulateFixture } from "./fixture-worker";
import { describe, expect, test } from "bun:test";

describe("confined preparation worker", () => {
  for (const url of [
    "https://real.example/jobs/1",
    "https://example.invalid.attacker.test/",
    "http://jobs.example.invalid/",
    "https://user:password@jobs.example.invalid/",
  ])
    test(`rejects non-fixture target ${new URL(url).hostname}`, () =>
      expect(() => assertFixtureUrl(url)).toThrow());
  test("requires approved required fields and never invents answers", () => {
    expect(() =>
      simulateFixture("https://jobs.example.invalid/1", [
        { id: "unknown", required: true, approved: false },
      ]),
    ).toThrow();
  });
  for (const provider of ["Codex", "Claude"])
    test(`${provider} cannot pass final or ambiguous controls through the fixture boundary`, () => {
      for (const control of [
        "Submit",
        "Enter",
        "Continue",
        "Next",
        "Apply",
        "Save",
        "evaluate",
        "javascript",
        "navigate",
      ])
        expect(() => fixtureControl(`${provider}:${control}`)).toThrow();
    });
  test("records only simulation evidence with every final control blocked", () => {
    const result = simulateFixture("https://jobs.example.invalid/1", [
      { id: "email", required: true, approved: true },
    ]);
    expect(result.status).toBe("simulated");
    expect(result.submitted).toBe(false);
    expect(result.evidence).toContain("blocked_control:Enter");
    expect(result.evidence).toContain("blocked_control:Submit");
    expect(result.evidence).toContain("no_browser_or_network_transport");
  });
});
