import { timeZoneSchema } from "@jobpilot/contracts/pilot/schedule";

export function quotaDay(now: Date, timeZone: string) {
  timeZoneSchema.parse(timeZone);
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid quota clock");
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const key = (timestamp: number) => {
    const parts = formatter.formatToParts(timestamp);
    const part = (kind: string) => parts.find((entry) => entry.type === kind)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  const date = key(now.getTime());
  const midnight = Date.parse(`${date}T00:00:00.000Z`);
  const tomorrow = new Date(midnight + 86_400_000).toISOString().slice(0, 10);
  const boundary = (target: string, center: number) => {
    let low = center - 36 * 3_600_000;
    let high = center + 36 * 3_600_000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (key(mid) < target) low = mid + 1;
      else high = mid;
    }
    return new Date(low);
  };
  return {
    date: new Date(midnight),
    timeZone,
    startsAt: boundary(date, midnight),
    resetsAt: boundary(tomorrow, midnight + 86_400_000),
  };
}
