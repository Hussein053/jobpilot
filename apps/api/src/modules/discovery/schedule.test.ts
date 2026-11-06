import { AUTO_APPLY_DEFAULTS } from "@jobpilot/contracts/auto-apply";
import { discoverySlot } from "./schedule";
import { expect, test } from "bun:test";

test("hourly slots are server-timed and allow only the boundary grace window", () => {
  const settings = { ...AUTO_APPLY_DEFAULTS, timeZone: "UTC" };
  expect(
    discoverySlot(settings, "scheduled", new Date("2026-11-03T10:03:42Z"))?.at.toISOString(),
  ).toBe("2026-11-03T10:00:00.000Z");
  expect(discoverySlot(settings, "scheduled", new Date("2026-11-03T10:05:00Z"))).toBeNull();
});
test("manual frequency denies scheduled searches but permits a bounded manual slot", () => {
  const settings = { ...AUTO_APPLY_DEFAULTS, searchFrequency: "manual" as const };
  const now = new Date("2026-11-03T10:25:00Z");
  expect(discoverySlot(settings, "scheduled", now)).toBeNull();
  expect(discoverySlot(settings, "manual", now)?.key).toBe("manual:2026-11-03T10:00:00.000Z");
});
test("selected daily hours use the saved timezone", () => {
  const settings = {
    ...AUTO_APPLY_DEFAULTS,
    timeZone: "America/New_York",
    searchFrequency: "three_times_daily" as const,
    runHours: [9, 13, 17],
  };
  expect(discoverySlot(settings, "scheduled", new Date("2026-11-03T14:00:00Z"))).not.toBeNull();
  expect(discoverySlot(settings, "scheduled", new Date("2026-11-03T15:00:00Z"))).toBeNull();
});
test("repeated DST hours are separate hourly slots but one selected-hour search", () => {
  const settings = { ...AUTO_APPLY_DEFAULTS, timeZone: "America/New_York", runHours: [1, 9, 17] };
  const first = new Date("2026-11-01T05:00:00Z");
  const repeated = new Date("2026-11-01T06:00:00Z");
  expect(discoverySlot(settings, "scheduled", first)?.key).not.toBe(
    discoverySlot(settings, "scheduled", repeated)?.key,
  );
  const selected = { ...settings, searchFrequency: "three_times_daily" as const };
  expect(discoverySlot(selected, "scheduled", first)?.key).toBe(
    discoverySlot(selected, "scheduled", repeated)?.key,
  );
});
test("a skipped local hour is not backfilled automatically", () => {
  const settings = {
    ...AUTO_APPLY_DEFAULTS,
    timeZone: "America/New_York",
    searchFrequency: "three_times_daily" as const,
    runHours: [2, 9, 17],
  };
  expect(discoverySlot(settings, "scheduled", new Date("2026-03-08T07:00:00Z"))).toBeNull();
});
test("quarter-hour timezones work with the inactive fifteen-minute tick template", () => {
  const settings = { ...AUTO_APPLY_DEFAULTS, timeZone: "Asia/Kathmandu" };
  expect(
    discoverySlot(settings, "scheduled", new Date("2026-11-03T03:15:00Z"))?.at.toISOString(),
  ).toBe("2026-11-03T03:15:00.000Z");
  expect(discoverySlot(settings, "scheduled", new Date("2026-11-03T03:00:00Z"))).toBeNull();
});
