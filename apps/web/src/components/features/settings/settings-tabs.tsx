import type { ReactElement } from "react";
import { type Tab, TabStrip } from "@/components/ui/navigation/tab-strip";

const TABS: Tab[] = [
  { label: "Profile", href: "/settings/profile" },
  { label: "Auto-Apply", href: "/settings/auto-apply" },
  { label: "Information Bank", href: "/information-bank" },
  { label: "Email", href: "/settings/email" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "Credentials", href: "/settings/credentials" },
];

export function SettingsTabs(): ReactElement {
  return <TabStrip tabs={TABS} ariaLabel="Settings sections" />;
}
