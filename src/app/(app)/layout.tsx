import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { filterModules } from "@/lib/nav";
import { requireUser } from "@/server/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const menuCollapsed = (await cookies()).get("navmenu")?.value === "collapsed";

  return (
    <AppShell
      modules={filterModules(user.permissions)}
      tenantName={user.tenantName}
      user={{ name: user.name, email: user.email, roleName: user.roleName, isOwner: user.isOwner }}
      menuCollapsed={menuCollapsed}
    >
      {children}
    </AppShell>
  );
}
