"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  AlarmClock,
  BarChart3,
  Bell,
  Check,
  Clock,
  Building2,
  CalendarClock,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  LayoutGrid,
  ListTodo,
  MessageCircle,
  Package,
  Send,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { GlobalSearch } from "@/components/global-search";
import { UserMenu } from "@/components/user-menu";
import { AiDock } from "@/components/ai/ai-dock";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { KindTag } from "@/components/crm/tasks";
import { runAction } from "@/hooks/use-action-form";
import { snoozeTaskAction, toggleTaskAction } from "@/app/(app)/schedule/actions";
import type { DueReminder } from "@/server/badges";
import { activeNav, type BadgeKey, type NavModule } from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Building2,
  CalendarClock,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListTodo,
  Mail,
  MessageCircle,
  Package,
  Send,
  Settings,
};

type Badges = Partial<Record<BadgeKey, number>> & { due?: DueReminder[] };
type UserInfo = { name: string; email: string; roleName: string; isOwner: boolean };

const MENU_COOKIE = "navmenu";

/** 手机底部标签栏固定的 4 个模块（按顺序，没权限的跳过），第 5 个是「更多」 */
const TAB_KEYS = ["dashboard", "todo", "customers", "whatsapp"] as const;

/** 后台外壳：顶栏（品牌 + 搜索 + 提醒 + 账号）、左侧 72px 模块图标栏、模块二级菜单 */
export function AppShell({
  modules,
  tenantName,
  user,
  menuCollapsed: initialCollapsed,
  ai,
  children,
}: {
  modules: NavModule[];
  tenantName: string;
  user: UserInfo;
  menuCollapsed: boolean;
  /** 能用 AI 时是对话记录的存储 key，不能用为 null */
  ai: string | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [badges, reloadBadges] = useBadges(pathname);
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
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-sidebar-border bg-card/95 pt-[env(safe-area-inset-top)] pr-2 pl-3 backdrop-blur [box-sizing:content-box] md:h-14 md:gap-3 md:pr-4 md:pl-0">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5 md:w-[17rem]">
          <span className="hidden w-[72px] shrink-0 justify-center md:flex">
            <BrandMark className="size-9" />
          </span>
          <span className="grid min-w-0 gap-1">
            <Brand className="h-5 md:h-[18px]" />
            <span className="hidden truncate text-xs leading-none text-muted-foreground sm:block">{tenantName}</span>
          </span>
        </Link>
        <div className="flex flex-1 justify-end md:justify-center">
          <GlobalSearch />
        </div>
        <div className="flex items-center md:gap-1">
          <Reminders modules={modules} badges={badges} reload={reloadBadges} />
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

        <main className="min-w-0 flex-1 px-3 pt-3 pb-[calc(4.75rem+env(safe-area-inset-bottom))] md:p-6">
          {menu && <SubTabs groups={menu} activeLeaf={active.leaf} />}
          {children}
        </main>
      </div>

      {ai && (
        <Suspense>
          <AiDock storageKey={ai} />
        </Suspense>
      )}

      <TabBar modules={modules} activeKey={active?.module.key} badges={badges} moreOpen={mobileOpen} onMore={() => setMobileOpen(true)} />

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 overflow-y-auto rounded-t-3xl px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          // 点了任一链接就收起
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setMobileOpen(false);
          }}
        >
          <span className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/25" aria-hidden />
          <SheetTitle className="px-1 text-base">全部功能</SheetTitle>
          <SheetDescription className="sr-only">在这里进入所有模块</SheetDescription>
          <ul className="mt-3 grid grid-cols-4 gap-y-4">
            {modules.map((m) => {
              const Icon = ICONS[m.icon] ?? ChevronRight;
              const on = active?.module.key === m.key;
              const count = m.badge ? (badges[m.badge] ?? 0) : 0;
              return (
                <li key={m.key}>
                  <Link href={m.href} className="flex flex-col items-center gap-1.5 text-xs font-medium">
                    <span
                      className={cn(
                        "relative flex size-12 items-center justify-center rounded-2xl",
                        on ? "bg-primary text-primary-foreground" : "bg-accent text-primary",
                      )}
                    >
                      <Icon className="size-[22px]" />
                      {count > 0 && (
                        <span className="absolute -top-1 -right-1">
                          <CountPill count={count} />
                        </span>
                      )}
                    </span>
                    {m.title}
                  </Link>
                </li>
              );
            })}
          </ul>
          {modules
            .filter((m) => m.menu?.length)
            .map((m) => (
              <section key={m.key} className="mt-5">
                <h3 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{m.title}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {m
                    .menu!.flatMap((g) => g.items)
                    .map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "flex h-11 items-center rounded-xl px-3.5 text-sm",
                          item.href === active?.leaf ? "bg-accent font-semibold text-primary" : "bg-muted/60",
                        )}
                      >
                        {item.title}
                      </Link>
                    ))}
                </div>
              </section>
            ))}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** 手机底部标签栏：4 个常用模块 + 更多 */
function TabBar({
  modules,
  activeKey,
  badges,
  moreOpen,
  onMore,
}: {
  modules: NavModule[];
  activeKey?: string;
  badges: Badges;
  moreOpen: boolean;
  onMore: () => void;
}) {
  // 没有 WhatsApp 权限时，「沟通」位换成邮件
  const tabs = TAB_KEYS.map((k) => modules.find((m) => m.key === k) ?? (k === "whatsapp" ? modules.find((m) => m.key === "mail") : undefined)).filter(
    (m): m is NavModule => !!m,
  );
  const inTabs = tabs.some((t) => t.key === activeKey);
  // 「更多」上的红点：不在标签栏里的模块的未读数
  const moreCount = modules.filter((m) => m.badge && !tabs.includes(m)).reduce((n, m) => n + (badges[m.badge!] ?? 0), 0);
  const item = "relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] leading-none font-medium transition-colors";
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(3.75rem+env(safe-area-inset-bottom))] border-t border-sidebar-border bg-card/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((m) => {
        const Icon = ICONS[m.icon] ?? ChevronRight;
        const on = !moreOpen && m.key === activeKey;
        const count = m.badge ? (badges[m.badge] ?? 0) : 0;
        return (
          <Link key={m.key} href={m.href} aria-current={on ? "page" : undefined} className={cn(item, on ? "text-primary" : "text-muted-foreground")}>
            <span className={cn("relative flex h-7 w-12 items-center justify-center rounded-full transition-colors", on && "bg-accent")}>
              <Icon className="size-[21px]" strokeWidth={on ? 2.2 : 1.8} />
              {count > 0 && (
                <span className="absolute -top-1 right-1">
                  <CountPill count={count} />
                </span>
              )}
            </span>
            {m.title}
          </Link>
        );
      })}
      <button type="button" onClick={onMore} className={cn(item, moreOpen || !inTabs ? "text-primary" : "text-muted-foreground")}>
        <span
          className={cn("relative flex h-7 w-12 items-center justify-center rounded-full transition-colors", (moreOpen || !inTabs) && "bg-accent")}
        >
          <LayoutGrid className="size-[21px]" strokeWidth={moreOpen || !inTabs ? 2.2 : 1.8} />
          {moreCount > 0 && (
            <span className="absolute -top-1 right-1">
              <CountPill count={moreCount} />
            </span>
          )}
        </span>
        更多
      </button>
    </nav>
  );
}

/** 手机上模块的二级菜单：页面顶部一行可横滑的胶囊（客户列表 / 公海 / 联系人…） */
function SubTabs({ groups, activeLeaf }: { groups: NonNullable<NavModule["menu"]>; activeLeaf?: string }) {
  const items = groups.flatMap((g) => g.items);
  if (items.length < 2) return null;
  return (
    <nav aria-label="二级菜单" className="-mx-3 mb-3 flex gap-2 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] md:hidden">
      {items.map((i) => {
        const on = i.href === activeLeaf;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex h-8 shrink-0 items-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap ring-1 transition-colors",
              on ? "bg-primary text-primary-foreground ring-primary" : "bg-card text-foreground/75 ring-border/70",
            )}
          >
            {i.title}
          </Link>
        );
      })}
    </nav>
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
  todo: "待办收件箱",
  leads: "待处理线索",
  mail: "未读邮件",
  whatsapp: "未读 WhatsApp 消息",
  tasks: "到期的跟进提醒",
};

/** 顶栏提醒：到点的跟进提醒（可直接完成 / 推迟），再汇总线索、邮件、WhatsApp 的未处理数 */
function Reminders({ modules, badges, reload }: { modules: NavModule[]; badges: Badges; reload: () => void }) {
  const [open, setOpen] = useState(false);
  // 「待办」是其它几项的汇总，不重复计数，只在底部给个入口
  const items = modules.filter((m) => m.badge && m.badge !== "todo").map((m) => ({ href: m.href, key: m.badge!, count: badges[m.badge!] ?? 0 }));
  const total = items.reduce((s, i) => s + i.count, 0);
  const todo = modules.find((m) => m.badge === "todo");
  const due = badges.due ?? [];
  if (!items.length) return null;
  const act = async (p: Promise<unknown>) => {
    await p;
    reload();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={total ? `提醒，${total} 条未处理` : "提醒"}
        >
          <Bell className={cn("size-[18px]", (badges.tasks ?? 0) > 0 && "text-foreground")} />
          {total > 0 && (
            <span className="absolute top-0.5 right-0.5">
              <CountPill count={total} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <p className="px-3.5 pt-3 pb-2 text-sm font-semibold">提醒</p>
        {due.length > 0 && (
          <ul className="max-h-80 overflow-y-auto border-y border-border/70">
            {due.map((t) => (
              <li key={t.id} className="flex items-start gap-2 px-3.5 py-2.5 hover:bg-muted/40">
                <AlarmClock className="mt-0.5 size-4 shrink-0 text-destructive" />
                <Link
                  href={t.link ?? (t.customerId ? `/customers/${t.customerId}` : "/schedule")}
                  onClick={() => setOpen(false)}
                  className="min-w-0 flex-1"
                >
                  <span className="flex items-center gap-1.5">
                    <KindTag kind={t.kind} />
                    <span className="truncate text-sm">{t.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[t.customerName, t.note].filter(Boolean).join(" · ") || "点击查看"}
                  </span>
                </Link>
                <span className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    title="推迟到明天上午"
                    aria-label="推迟到明天上午"
                    onClick={() => act(runAction(snoozeTaskAction(t.id, "tomorrow")))}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Clock className="size-4" />
                  </button>
                  <button
                    type="button"
                    title="标记完成"
                    aria-label="标记完成"
                    onClick={() => act(runAction(toggleTaskAction(t.id, true)))}
                    className="rounded-md p-1 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700"
                  >
                    <Check className="size-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <ul className="p-1.5">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} onClick={() => setOpen(false)} className="flex justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                {REMINDER_LABEL[i.key]}
                <span className={cn("tabular-nums", i.count ? "font-semibold text-destructive" : "text-muted-foreground")}>{i.count}</span>
              </Link>
            </li>
          ))}
        </ul>
        {todo && (
          <Link
            href={todo.href}
            onClick={() => setOpen(false)}
            className="flex items-center justify-between border-t px-3.5 py-2.5 text-sm font-medium text-primary hover:bg-muted/40"
          >
            打开待办收件箱，一次处理完
            <ChevronRight className="size-4" />
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}

const SEEN_KEY = "crm:due-seen";

/** 未读数：切换页面、窗口重新获得焦点时，以及每分钟刷新一次；有新到点的提醒时弹一条通知 */
function useBadges(pathname: string) {
  const [badges, setBadges] = useState<Badges>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/badges", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b: Badges | null) => {
          if (!alive || !b) return;
          setBadges(b);
          notifyDue(b.due ?? []);
        })
        .catch(() => {});
    void load();
    const t = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", load);
    };
  }, [pathname, tick]);
  return [badges, () => setTick((n) => n + 1)] as const;
}

function notifyDue(due: DueReminder[]) {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
  } catch {}
  // 推迟后再到点算新的一次：用 id + 时间 做键
  const fresh = due.filter((t) => !seen.includes(`${t.id}@${t.dueAt}`));
  if (!fresh.length) return;
  for (const t of fresh.slice(0, 3)) {
    toast(t.title, {
      icon: <AlarmClock className="size-4 text-destructive" />,
      description: [t.customerName, t.note].filter(Boolean).join(" · ") || undefined,
      duration: 12_000,
      action: { label: "去处理", onClick: () => window.location.assign(t.link ?? (t.customerId ? `/customers/${t.customerId}` : "/schedule")) },
    });
  }
  localStorage.setItem(SEEN_KEY, JSON.stringify([...fresh.map((t) => `${t.id}@${t.dueAt}`), ...seen].slice(0, 200)));
}
