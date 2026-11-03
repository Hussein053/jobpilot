import { quotaDay } from "./day-window";
import { describe, expect, test } from "bun:test";

describe("quota days in the user's time zone", () => {
  test("uses local rather than UTC date and excludes the next midnight", () => {
    const day = quotaDay(new Date("2026-11-02T01:00:00Z"), "America/New_York");
    expect(day.date.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(day.startsAt.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(day.resetsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  test("spring daylight saving days have 23 hours", () => {
    const day = quotaDay(new Date("2026-03-08T16:00:00Z"), "America/New_York");
    expect(day.resetsAt.getTime() - day.startsAt.getTime()).toBe(23 * 3600000);
  });
  test("fall daylight saving days have 25 hours", () => {
    const day = quotaDay(new Date("2026-11-01T16:00:00Z"), "America/New_York");
    expect(day.resetsAt.getTime() - day.startsAt.getTime()).toBe(25 * 3600000);
  });
  test("handles fractional offsets and UTC midnight", () => {
    expect(
      quotaDay(new Date("2026-11-02T06:00:00Z"), "Asia/Kathmandu").startsAt.toISOString(),
    ).toBe("2026-11-01T18:15:00.000Z");
    expect(quotaDay(new Date("2026-11-02T00:00:00Z"), "UTC").startsAt.toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
  });
  test("handles zones whose midnight is skipped", () => {
    const day = quotaDay(new Date("2018-11-04T12:00:00Z"), "America/Sao_Paulo");
    expect(day.startsAt.toISOString()).toBe("2018-11-04T03:00:00.000Z");
    expect(day.resetsAt.toISOString()).toBe("2018-11-05T02:00:00.000Z");
  });
  test("rejects invalid time zones and clocks", () => {
    expect(() => quotaDay(new Date(), "not-a-zone")).toThrow();
    expect(() => quotaDay(new Date(NaN), "UTC")).toThrow();
  });
});
