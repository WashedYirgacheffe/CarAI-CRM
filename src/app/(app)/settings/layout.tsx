import { requireUser } from "@/server/auth";
import { SETTINGS_NAV, filterNav } from "@/lib/nav";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const user = await requireUser();
  const groups = SETTINGS_NAV.map((g) => ({
    group: g.group,
    items: filterNav(g.items, user.permissions),
  })).filter((g) => g.items.length);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <SettingsNav groups={groups} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
