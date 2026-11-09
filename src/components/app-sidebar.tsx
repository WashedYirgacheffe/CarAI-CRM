"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Building2,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Package,
  Settings,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { BrandMark } from "@/components/brand";
import { NAV, filterNav, type BadgeKey, type NavItem } from "@/lib/nav";
import type { Permission } from "@/lib/permissions";

const ICONS: Record<string, LucideIcon> = {
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardList,
  FileText,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Package,
  Settings,
  Wallet,
};

function isActive(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  tenantName,
  permissions,
}: {
  tenantName: string;
  permissions: Permission[];
}) {
  const pathname = usePathname();
  const badges = useBadges(pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <BrandMark />
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">车车外贸 CRM</span>
                  <span className="truncate text-xs text-muted-foreground">{tenantName}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV.map((section) => {
          const items = filterNav(section.items, permissions);
          if (!items.length) return null;
          return (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarMenu>
                {items.map((item) => (
                  <NavEntry key={item.href} item={item} pathname={pathname} permissions={permissions} count={item.badge ? badges[item.badge] : 0} />
                ))}
              </SidebarMenu>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

/** 未读数：切换页面、窗口重新获得焦点时，以及每分钟刷新一次 */
function useBadges(pathname: string) {
  const [badges, setBadges] = useState<Partial<Record<BadgeKey, number>>>({});
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

function NavEntry({
  item,
  pathname,
  permissions,
  count = 0,
}: {
  item: NavItem;
  pathname: string;
  permissions: Permission[];
  count?: number;
}) {
  const Icon = ICONS[item.icon] ?? ChevronRight;
  const children = item.children ? filterNav(item.children, permissions) : [];
  const active = isActive(pathname, item.href);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active && !children.length} tooltip={item.title}>
        <Link href={item.href}>
          <Icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {count > 0 && (
        <SidebarMenuBadge className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground tabular-nums peer-hover/menu-button:text-primary-foreground">
          {count > 99 ? "99+" : count}
        </SidebarMenuBadge>
      )}
      {item.phase && !children.length && !count && (
        <SidebarMenuBadge className="text-[10px] text-muted-foreground">{item.phase}</SidebarMenuBadge>
      )}
      {children.length > 0 && (
        <SidebarMenuSub>
          {children.map((child) => (
            <SidebarMenuSubItem key={child.href}>
              <SidebarMenuSubButton
                asChild
                isActive={isActive(pathname, child.href, child.href === item.href)}
              >
                <Link href={child.href}>{child.title}</Link>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
