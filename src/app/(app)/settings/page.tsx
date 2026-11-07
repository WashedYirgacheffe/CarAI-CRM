import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { SETTINGS_NAV, filterNav } from "@/lib/nav";

/** /settings 跳到当前用户能访问的第一个设置页 */
export default async function SettingsIndex() {
  const user = await requireUser();
  const first = SETTINGS_NAV.flatMap((g) => filterNav(g.items, user.permissions))[0];
  redirect(first?.href ?? "/settings/profile");
}
