// 权限点目录。前后端共用（不依赖服务端模块）。
// 新增模块时在这里登记权限点，再在角色编辑页里自动出现。

export const PERMISSION_GROUPS = [
  {
    key: "customer",
    label: "客户",
    items: [
      { key: "customer.view", label: "查看客户" },
      { key: "customer.create", label: "新建客户" },
      { key: "customer.edit", label: "编辑客户" },
      { key: "customer.delete", label: "删除客户" },
      { key: "customer.transfer", label: "转移客户" },
      { key: "customer.export", label: "导出客户" },
    ],
  },
  {
    key: "pool",
    label: "公海",
    items: [
      { key: "pool.view", label: "查看公海" },
      { key: "pool.claim", label: "领取客户" },
      { key: "pool.assign", label: "分配公海客户" },
    ],
  },
  {
    key: "lead",
    label: "线索 / 询盘",
    items: [
      { key: "lead.view", label: "查看线索" },
      { key: "lead.create", label: "新建线索" },
      { key: "lead.edit", label: "编辑线索" },
      { key: "lead.delete", label: "删除线索" },
      { key: "lead.assign", label: "分配线索" },
    ],
  },
  {
    key: "opportunity",
    label: "商机",
    items: [
      { key: "opportunity.view", label: "查看商机" },
      { key: "opportunity.create", label: "新建商机" },
      { key: "opportunity.edit", label: "编辑商机" },
      { key: "opportunity.delete", label: "删除商机" },
    ],
  },
  {
    key: "quotation",
    label: "报价单",
    items: [
      { key: "quotation.view", label: "查看报价单" },
      { key: "quotation.create", label: "新建报价单" },
      { key: "quotation.edit", label: "编辑报价单" },
      { key: "quotation.delete", label: "删除报价单" },
    ],
  },
  {
    key: "order",
    label: "订单",
    items: [
      { key: "order.view", label: "查看订单" },
      { key: "order.create", label: "新建订单" },
      { key: "order.edit", label: "编辑订单" },
      { key: "order.delete", label: "删除订单" },
    ],
  },
  {
    key: "product",
    label: "产品",
    items: [
      { key: "product.view", label: "查看产品" },
      { key: "product.manage", label: "管理产品" },
    ],
  },
  {
    key: "mail",
    label: "邮件",
    items: [{ key: "mail.use", label: "使用邮件" }],
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    items: [{ key: "whatsapp.use", label: "使用 WhatsApp" }],
  },
  {
    key: "ai",
    label: "AI 助手",
    items: [{ key: "ai.use", label: "使用 AI（写信、翻译、摘要、跟进建议）" }],
  },
  {
    key: "report",
    label: "统计",
    items: [{ key: "report.view", label: "查看统计报表" }],
  },
  {
    key: "settings",
    label: "系统设置",
    items: [
      { key: "settings.company", label: "企业信息" },
      { key: "settings.org", label: "部门与成员" },
      { key: "settings.role", label: "角色权限" },
      { key: "settings.business", label: "业务规则（公海、字段、阶段）" },
    ],
  },
] as const;

export type Permission =
  (typeof PERMISSION_GROUPS)[number]["items"][number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) =>
  g.items.map((i) => i.key),
);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}

export const DATA_SCOPE_OPTIONS = [
  { value: "SELF", label: "仅本人", hint: "只能看到自己负责的数据" },
  { value: "DEPARTMENT", label: "本部门", hint: "可看到本部门及下级部门的数据" },
  { value: "ALL", label: "全公司", hint: "可看到全公司的数据" },
] as const;

export type DataScopeValue = (typeof DATA_SCOPE_OPTIONS)[number]["value"];

/** 注册企业时自动创建的三个内置角色 */
export const SYSTEM_ROLES: {
  systemKey: "admin" | "manager" | "sales";
  name: string;
  description: string;
  dataScope: DataScopeValue;
  permissions: Permission[];
}[] = [
  {
    systemKey: "admin",
    name: "管理员",
    description: "拥有全部功能和全公司数据权限",
    dataScope: "ALL",
    permissions: ALL_PERMISSIONS,
  },
  {
    systemKey: "manager",
    name: "销售经理",
    description: "管理本部门的客户、商机和单据",
    dataScope: "DEPARTMENT",
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("settings.")),
  },
  {
    systemKey: "sales",
    name: "业务员",
    description: "跟进自己负责的客户",
    dataScope: "SELF",
    permissions: [
      "customer.view",
      "customer.create",
      "customer.edit",
      "pool.view",
      "pool.claim",
      "lead.view",
      "lead.create",
      "lead.edit",
      "opportunity.view",
      "opportunity.create",
      "opportunity.edit",
      "quotation.view",
      "quotation.create",
      "quotation.edit",
      "order.view",
      "order.create",
      "product.view",
      "mail.use",
      "whatsapp.use",
      "ai.use",
    ],
  },
];
