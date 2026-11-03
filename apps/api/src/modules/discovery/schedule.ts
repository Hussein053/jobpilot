import type { AutoApplyPreferences } from "@jobpilot/contracts/auto-apply";

export function discoverySlot(
  settings: AutoApplyPreferences,
  trigger: "scheduled" | "manual",
  now: Date,
) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid discovery clock");
  if (trigger === "manual") {
    const at = new Date(Math.floor(now.getTime() / 3600000) * 3600000);
    return { key: `manual:${at.toISOString()}`, at };
  }
  if (settings.searchFrequency === "manual") return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: settings.timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const minute = Number(part("minute"));
  const hour = Number(part("hour"));
  if (minute >= 5) return null;
  const at = new Date(
    now.getTime() - minute * 60000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds(),
  );
  if (settings.searchFrequency === "hourly") return { key: `hourly:${at.toISOString()}`, at };
  if (!settings.runHours.includes(hour)) return null;
  return { key: `hours:${part("year")}-${part("month")}-${part("day")}:${hour}`, at };
}
