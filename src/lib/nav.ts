import type { Permission } from "@/lib/permissions";

export type NavLeaf = {
  title: string;
  href: string;
  permission?: Permission;
  /** 计划在哪个阶段上线，未上线的显示为「规划中」 */
  phase?: string;
};

/** 侧边栏数字提醒（/api/badges 返回） */
export type BadgeKey = "leads" | "mail" | "whatsapp";

export type NavItem = NavLeaf & {
  icon: string;
  badge?: BadgeKey;
  children?: NavLeaf[];
};

export type NavSection = { label: string; items: NavItem[] };

/** 后台菜单（参照 OKKI 分组）。icon 是 lucide 图标名，在 app-sidebar.tsx 里映射。 */
export const NAV: NavSection[] = [
  {
    label: "客户",
    items: [
      { title: "工作台", href: "/dashboard", icon: "LayoutDashboard" },
      {
        title: "客户",
        href: "/customers",
        icon: "Building2",
        permission: "customer.view",
        children: [
          { title: "我的客户", href: "/customers", permission: "customer.view" },
          { title: "公海客户", href: "/customers/pool", permission: "pool.view" },
          { title: "联系人", href: "/customers/contacts", permission: "customer.view" },
        ],
      },
      { title: "线索 / 询盘", href: "/leads", icon: "Inbox", permission: "lead.view", badge: "leads" },
      { title: "商机", href: "/opportunities", icon: "KanbanSquare", permission: "opportunity.view" },
    ],
  },
  {
    label: "沟通",
    items: [
      { title: "邮件", href: "/mail", icon: "Mail", permission: "mail.use", badge: "mail" },
      { title: "WhatsApp", href: "/whatsapp", icon: "MessageCircle", permission: "whatsapp.use", badge: "whatsapp" },
    ],
  },
  {
    label: "交易",
    items: [
      { title: "产品", href: "/products", icon: "Package", permission: "product.view" },
      { title: "报价单", href: "/quotations", icon: "FileText", permission: "quotation.view" },
      { title: "订单", href: "/orders", icon: "ClipboardList", permission: "order.view" },
      { title: "回款", href: "/payments", icon: "Wallet", permission: "order.view" },
    ],
  },
  {
    label: "协同",
    items: [{ title: "日程", href: "/schedule", icon: "CalendarClock", permission: "customer.view" }],
  },
  {
    label: "团队数据",
    items: [{ title: "统计", href: "/reports", icon: "BarChart3", permission: "report.view" }],
  },
  {
    label: "系统",
    items: [{ title: "设置", href: "/settings", icon: "Settings" }],
  },
];

/** 设置页二级菜单 */
export const SETTINGS_NAV: { group: string; items: NavLeaf[] }[] = [
  {
    group: "企业",
    items: [
      { title: "企业信息", href: "/settings/company", permission: "settings.company" },
      { title: "组织架构", href: "/settings/departments", permission: "settings.org" },
      { title: "成员管理", href: "/settings/members", permission: "settings.org" },
      { title: "角色权限", href: "/settings/roles", permission: "settings.role" },
    ],
  },
  {
    group: "业务规则",
    items: [
      { title: "公海规则", href: "/settings/pool-rules", permission: "settings.business" },
      { title: "客户分类", href: "/settings/fields", permission: "settings.business" },
      { title: "商机阶段", href: "/settings/stages", permission: "settings.business" },
      { title: "单据设置", href: "/settings/documents", permission: "settings.business" },
    ],
  },
  {
    group: "个人",
    items: [
      { title: "个人资料", href: "/settings/profile" },
      { title: "邮箱绑定", href: "/settings/mailboxes", permission: "mail.use" },
      { title: "WhatsApp 绑定", href: "/settings/whatsapp", permission: "whatsapp.use" },
    ],
  },
];

export function filterNav<T extends NavLeaf>(items: T[], permissions: Permission[]): T[] {
  return items.filter((i) => !i.permission || permissions.includes(i.permission));
}
