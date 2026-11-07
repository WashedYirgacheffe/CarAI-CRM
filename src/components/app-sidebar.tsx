"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
import { NAV, filterNav, type NavItem } from "@/lib/nav";
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
                  <NavEntry key={item.href} item={item} pathname={pathname} permissions={permissions} />
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

function NavEntry({
  item,
  pathname,
  permissions,
}: {
  item: NavItem;
  pathname: string;
  permissions: Permission[];
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
      {item.phase && !children.length && (
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
