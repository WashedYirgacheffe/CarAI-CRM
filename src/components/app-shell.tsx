"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Menu,
  MessageCircle,
  Package,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { GlobalSearch } from "@/components/global-search";
import { UserMenu } from "@/components/user-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeNav, type BadgeKey, type NavModule } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Building2,
  CalendarClock,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Package,
  Settings,
};

type Badges = Partial<Record<BadgeKey, number>>;
type UserInfo = { name: string; email: string; roleName: string; isOwner: boolean };

const MENU_COOKIE = "navmenu";

/** 后台外壳：顶栏（品牌 + 搜索 + 提醒 + 账号）、左侧 72px 模块图标栏、模块二级菜单 */
export function AppShell({
  modules,
  tenantName,
  user,
  menuCollapsed: initialCollapsed,
  children,
}: {
  modules: NavModule[];
  tenantName: string;
  user: UserInfo;
  menuCollapsed: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const badges = useBadges(pathname);
  const active = activeNav(modules, pathname);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleMenu = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${MENU_COOKIE}=${next ? "collapsed" : "open"}; path=/; max-age=31536000; samesite=lax`;
  };

  const menu = active?.module.menu;

  return (
    <div className="min-h-svh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-sidebar-border bg-card/95 pr-4 pl-3 backdrop-blur md:pl-0">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted md:hidden"
          aria-label="打开菜单"
        >
          <Menu className="size-5" />
        </button>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 md:w-[17rem]">
          <span className="hidden w-[72px] shrink-0 justify-center md:flex">
            <BrandMark className="size-9" />
          </span>
          <BrandMark className="size-8 md:hidden" />
          <span className="grid min-w-0 gap-1">
            <Brand className="h-[18px]" />
            <span className="hidden truncate text-xs leading-none text-muted-foreground sm:block">{tenantName}</span>
          </span>
        </Link>
        <div className="flex flex-1 justify-center">
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-1">
          <Reminders modules={modules} badges={badges} />
          <UserMenu {...user} />
        </div>
      </header>

      <div className="flex">
        <nav
          aria-label="模块"
          className="sticky top-14 hidden h-[calc(100svh-3.5rem)] w-[72px] shrink-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-sidebar-border bg-sidebar px-2 py-3 md:flex"
        >
          {modules.map((m) => (
            <RailItem key={m.key} module={m} active={active?.module.key === m.key} count={m.badge ? badges[m.badge] : 0} />
          ))}
        </nav>

        {menu && (
          <aside
            aria-label={`${active.module.title}菜单`}
            className={cn(
              "sticky top-14 hidden h-[calc(100svh-3.5rem)] shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-out md:block",
              collapsed ? "w-6" : "w-44",
            )}
          >
            {collapsed ? (
              <button
                type="button"
                onClick={toggleMenu}
                className="mt-4 flex h-8 w-full items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label="展开菜单"
              >
                <ChevronsRight className="size-4" />
              </button>
            ) : (
              <div className="flex h-full flex-col overflow-y-auto px-3 py-4">
                <div className="mb-3 flex items-center justify-between pl-2">
                  <span className="text-[15px] font-bold tracking-tight">{active.module.title}</span>
                  <button
                    type="button"
                    onClick={toggleMenu}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="收起菜单"
                  >
                    <ChevronsLeft className="size-4" />
                  </button>
                </div>
                <MenuGroups groups={menu} activeLeaf={active.leaf} />
              </div>
            )}
          </aside>
        )}

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 gap-0 overflow-y-auto p-3"
          // 点了任一链接就收起抽屉
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}
        >
          <SheetTitle className="px-2 py-2">
            <Brand className="h-6" />
          </SheetTitle>
          {modules.map((m) => {
            const Icon = ICONS[m.icon] ?? ChevronRight;
            const isActive = active?.module.key === m.key;
            const count = m.badge ? badges[m.badge] ?? 0 : 0;
            return (
              <div key={m.key} className="py-0.5">
                <Link
                  href={m.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                    isActive && !m.menu ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  <Icon className="size-[18px]" />
                  <span className="flex-1">{m.title}</span>
                  {count > 0 && <CountPill count={count} />}
                </Link>
                {m.menu && isActive && (
                  <div className="ml-7 py-1">
                    <MenuGroups groups={m.menu} activeLeaf={active.leaf} />
                  </div>
                )}
              </div>
            );
          })}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RailItem({ module: m, active, count = 0 }: { module: NavModule; active: boolean; count?: number }) {
  const Icon = ICONS[m.icon] ?? ChevronRight;
  return (
    <Link
      href={m.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] leading-none font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_var(--color-primary)]"
          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
      <span className="whitespace-nowrap">{m.title}</span>
      {count > 0 && (
        <span className="absolute top-1 right-1">
          <CountPill count={count} />
        </span>
      )}
    </Link>
  );
}

function MenuGroups({ groups, activeLeaf }: { groups: NonNullable<NavModule["menu"]>; activeLeaf?: string }) {
  return (
    <div className="space-y-4">
      {groups.map((g, gi) => (
        <div key={g.group ?? gi}>
          {g.group && <p className="mb-1 px-2 text-xs text-muted-foreground">{g.group}</p>}
          <ul className="space-y-0.5">
            {g.items.map((item) => {
              const on = item.href === activeLeaf;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-lg px-2.5 py-2 text-sm transition-colors",
                      on
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                        : "text-foreground/75 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {item.title}
                    {item.phase && <span className="text-[10px] text-muted-foreground">{item.phase}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums ring-2 ring-sidebar">
      {count > 99 ? "99+" : count}
    </span>
  );
}

const REMINDER_LABEL: Record<BadgeKey, string> = {
  leads: "待处理线索",
  mail: "未读邮件",
  whatsapp: "未读 WhatsApp 消息",
};

/** 顶栏提醒：汇总线索、邮件、WhatsApp 的未处理数 */
function Reminders({ modules, badges }: { modules: NavModule[]; badges: Badges }) {
  const items = modules.filter((m) => m.badge).map((m) => ({ href: m.href, key: m.badge!, count: badges[m.badge!] ?? 0 }));
  const total = items.reduce((s, i) => s + i.count, 0);
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={total ? `提醒，${total} 条未处理` : "提醒"}
        >
          <Bell className="size-[18px]" />
          {total > 0 && (
            <span className="absolute top-0.5 right-0.5">
              <CountPill count={total} />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>提醒</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((i) => (
          <DropdownMenuItem key={i.key} asChild>
            <Link href={i.href} className="flex justify-between">
              {REMINDER_LABEL[i.key]}
              <span className={cn("tabular-nums", i.count ? "font-semibold text-destructive" : "text-muted-foreground")}>{i.count}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 未读数：切换页面、窗口重新获得焦点时，以及每分钟刷新一次 */
function useBadges(pathname: string) {
  const [badges, setBadges] = useState<Badges>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/badges", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => alive && b && setBadges(b))
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [pathname]);
  return badges;
}
