/** AI 起草、用户确认后才执行的操作（前后端共用的类型） */

export const AI_ACTION_KINDS = [
  "send_whatsapp",
  "send_email",
  "create_quotation",
  "send_quotation",
  "send_product",
  "send_form",
  "create_task",
  "add_followup",
  "create_lead",
  "enroll_sequence",
  "set_sequence_status",
  // 客户和联系人
  "create_customer",
  "update_customer",
  "delete_customer",
  "transfer_customer",
  "release_customer",
  "save_contact",
  "delete_contact",
  // 线索
  "update_lead",
  "set_lead_status",
  "convert_lead",
  "delete_lead",
  // 日程、单据、商机、产品
  "complete_task",
  "delete_task",
  "set_quotation_status",
  "delete_quotation",
  "set_order_status",
  "delete_order",
  "move_opportunity",
  "delete_opportunity",
  "delete_product",
] as const;
export type AiActionKind = (typeof AI_ACTION_KINDS)[number];
export const isAiActionKind = (k: unknown): k is AiActionKind => typeof k === "string" && (AI_ACTION_KINDS as readonly string[]).includes(k);

/** 确认卡片：fields 只读展示，edit 里的参数用户可以直接改 */
export type ActionCard = {
  kind: AiActionKind;
  title: string;
  fields: { label: string; value: string }[];
  edit?: { key: string; label: string; multiline?: boolean }[];
  params: Record<string, string>;
  confirm: string;
  /** 会对外发出（消息、邮件、群发）或批量影响数据：按钮用醒目色并多一句提示 */
  outward?: boolean;
  /** 删除这类不可逆的操作：红色提示，要点两次才执行 */
  danger?: boolean;
  /** 不想在这里执行时，去完整页面里改 */
  alt?: { label: string; href: string };
};

export type ActionResult = { ok: boolean; message: string; href?: string; hrefLabel?: string };
