import type { Permission } from "@/lib/permissions";

export type NavLeaf = {
  title: string;
  href: string;
  permission?: Permission;
  /** 计划在哪个阶段上线，未上线的显示为「规划中」 */
  phase?: string;
};

/** 图标栏数字提醒（/api/badges 返回） */
export type BadgeKey = "todo" | "leads" | "mail" | "whatsapp" | "tasks";

export type NavGroup = { group?: string; items: NavLeaf[] };

/** 一级模块：左侧图标栏的一项。有 menu 的模块在图标栏右边展开二级菜单 */
export type NavModule = {
  key: string;
  /** 图标栏上的短标签（2–4 个字） */
  title: string;
  href: string;
  /** lucide 图标名，在 app-shell.tsx 里映射 */
  icon: string;
  permission?: Permission;
  badge?: BadgeKey;
  menu?: NavGroup[];
};

/** 后台模块（结构参照 OKKI：一级图标栏 + 模块二级菜单） */
export const NAV: NavModule[] = [
  { key: "dashboard", title: "工作台", href: "/dashboard", icon: "LayoutDashboard" },
  { key: "todo", title: "待办", href: "/todo", icon: "ListTodo", badge: "todo" },
  { key: "mail", title: "邮件", href: "/mail", icon: "Mail", permission: "mail.use", badge: "mail" },
  { key: "whatsapp", title: "沟通", href: "/whatsapp", icon: "MessageCircle", permission: "whatsapp.use", badge: "whatsapp" },
  { key: "marketing", title: "营销", href: "/marketing", icon: "Send", permission: "mail.use" },
  { key: "leads", title: "线索", href: "/leads", icon: "Inbox", permission: "lead.view", badge: "leads" },
  {
    key: "customers",
    title: "客户",
    href: "/customers",
    icon: "Building2",
    permission: "customer.view",
    menu: [
      {
        items: [
          { title: "客户列表", href: "/customers", permission: "customer.view" },
          { title: "公海客户", href: "/customers/pool", permission: "pool.view" },
          { title: "联系人", href: "/customers/contacts", permission: "customer.view" },
          { title: "建档建议", href: "/customers/suggestions", permission: "customer.create" },
          { title: "客户查重", href: "/customers/duplicates", permission: "customer.view" },
        ],
      },
    ],
  },
  { key: "opportunities", title: "商机", href: "/opportunities", icon: "KanbanSquare", permission: "opportunity.view" },
  {
    key: "trade",
    title: "交易",
    href: "/products",
    icon: "Package",
    menu: [
      {
        items: [
          { title: "产品", href: "/products", permission: "product.view" },
          { title: "报价单", href: "/quotations", permission: "quotation.view" },
          { title: "销售订单", href: "/orders", permission: "order.view" },
          { title: "回款", href: "/payments", permission: "order.view" },
        ],
      },
    ],
  },
  { key: "schedule", title: "日程", href: "/schedule", icon: "CalendarClock", permission: "customer.view", badge: "tasks" },
  { key: "reports", title: "团队数据", href: "/reports", icon: "BarChart3", permission: "report.view" },
  { key: "settings", title: "设置", href: "/settings", icon: "Settings", menu: [] },
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

/** 按权限过滤模块和二级菜单；二级菜单全被滤掉的模块不显示，模块入口指向第一个能进的子页 */
export function filterModules(permissions: Permission[]): NavModule[] {
  const out: NavModule[] = [];
  for (const m of NAV) {
    if (m.permission && !permissions.includes(m.permission)) continue;
    if (!m.menu) {
      out.push(m);
      continue;
    }
    const source = m.key === "settings" ? SETTINGS_NAV : m.menu;
    const menu = source.map((g) => ({ ...g, items: filterNav(g.items, permissions) })).filter((g) => g.items.length);
    if (!menu.length) continue;
    out.push({ ...m, href: m.key === "settings" ? m.href : menu[0].items[0].href, menu });
  }
  return out;
}

function matches(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** 当前路径属于哪个模块、二级菜单里哪一项：取匹配最长的那个 */
export function activeNav(modules: NavModule[], pathname: string) {
  let best: { module: NavModule; leaf?: string; len: number } | null = null;
  for (const m of modules) {
    const hrefs = [m.href, ...(m.menu ?? []).flatMap((g) => g.items.map((i) => i.href))];
    for (const h of hrefs) {
      if (matches(pathname, h) && (!best || h.length > best.len)) best = { module: m, leaf: m.menu ? h : undefined, len: h.length };
    }
  }
  return best ? { module: best.module, leaf: best.leaf } : null;
}
